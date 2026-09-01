-- 0082: a lease table so test suites that touch a GLOBAL invariant serialize.
--
-- WHY THIS EXISTS, and why it is a table rather than an advisory lock.
--
-- `admin_operators_covered()` is deliberately global: "at least one active
-- admin can manage operators" is a property of the whole system, not of one
-- caller's rows. That is correct for production and it is exactly what makes
-- the tests around it fragile — a suite asserting "this is the LAST holder,
-- so disabling it must be refused" is only correct while no other holder
-- exists ANYWHERE.
--
-- Two things violate that, and both have now happened:
--
--   * WITHIN one run. vitest runs test FILES in parallel and nothing set
--     fileParallelism. `admin-invite` creates a manager role holding
--     `operators` in its beforeAll and keeps it for the whole file, so it
--     satisfies coverage while `admin-permissions` is asserting there is no
--     coverage left. This is what actually reddened main on 4097a77: the
--     disable that had to be refused succeeded, which DISABLED the actor, and
--     every later test in the file then failed `not_authorised` — one cause,
--     eight symptoms, none of them naming the real problem.
--
--   * ACROSS runs. Every open PR's CI points at the same Supabase project, so
--     three concurrent runs of the same suite create three sets of fixtures in
--     one database.
--
-- An advisory lock would be the obvious tool and is not available: PostgREST
-- pools connections, so a session-level `pg_advisory_lock` is taken on an
-- arbitrary pooled backend and released when that backend is recycled, not
-- when the suite finishes. A leased row is visible to every connection and
-- survives the pool.
--
-- THE LEASE EXPIRES ON PURPOSE. A crashed or killed run must not wedge every
-- future run, so a stale lease is stealable once `expires_at` passes. The
-- holder renews while it works (same function, see below), so a slow-but-alive
-- suite does not lose the lock it is still using.
--
-- THIS TABLE IS TEST INFRASTRUCTURE living in the production schema, which is
-- a real cost and worth stating rather than hiding: it is locked to
-- `service_role` only, carries no user data, and nothing in `src/` reads it.
-- It is here because the CI database IS a Supabase project with the same
-- migration history, and a table that only exists in one of them is the
-- divergence this repo has been bitten by before.

create table if not exists public.ci_test_locks (
  name text primary key,
  holder uuid not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

comment on table public.ci_test_locks is
  'Test-only mutex leases (see 0082). Serializes suites that assert on global '
  'invariants such as admin_operators_covered(). No user data; service_role only.';

alter table public.ci_test_locks enable row level security;
-- No policies at all: RLS with none denies everything to every client role,
-- and the privilege revoke below is the belt to that suspenders — a policy
-- added later by accident cannot re-open a table with no grants.
revoke all on table public.ci_test_locks from public, anon, authenticated;
grant select, insert, update, delete on table public.ci_test_locks to service_role;

-- ACQUIRE-OR-RENEW, in ONE statement.
--
-- Read-then-write here would be the very bug this repo keeps relearning: two
-- runners both seeing "expired" and both taking the lease. The conflict target
-- makes Postgres serialize them on the primary key, and the WHERE decides the
-- winner inside the same statement.
--
-- The `or l.holder = excluded.holder` arm is the renewal: the current holder
-- can always push its own expiry out, so a suite that runs longer than one TTL
-- keeps the lock instead of silently losing it to a waiter mid-assertion.
create or replace function public.ci_test_lock_acquire(
  p_name text,
  p_holder uuid,
  p_ttl_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_got boolean;
begin
  insert into public.ci_test_locks as l (name, holder, expires_at)
  values (p_name, p_holder, now() + make_interval(secs => p_ttl_seconds))
  on conflict (name) do update
     set holder = excluded.holder,
         acquired_at = now(),
         expires_at = excluded.expires_at
   where l.expires_at < now() or l.holder = excluded.holder
  returning true into v_got;

  -- No row came back => the conflicting lease is live and someone else's.
  return coalesce(v_got, false);
end;
$$;

-- Release only what you hold. Passing the holder means a run that lost its
-- lease to expiry cannot delete the lease its successor is now relying on.
create or replace function public.ci_test_lock_release(p_name text, p_holder uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ci_test_locks where name = p_name and holder = p_holder;
  return found;
end;
$$;

revoke all on function public.ci_test_lock_acquire(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.ci_test_lock_release(text, uuid) from public, anon, authenticated;
grant execute on function public.ci_test_lock_acquire(text, uuid, integer) to service_role;
grant execute on function public.ci_test_lock_release(text, uuid) to service_role;
