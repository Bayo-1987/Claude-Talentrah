-- 0236: the atomic free-message claim for Farah chat (S3).
--
-- WHAT IS WRONG TODAY. The gate reads how many free messages an account has used (3 are free in a rolling 30 days) and, if fewer than 3, answers "free". Nothing is written until AFTER the model call, when
-- the reply has completed. So N requests that start within one reply's time all see the same count, all pass, all call the model (and spend), and all commit: an account that had used 2 can use 12
-- (tests/farah/chat-gate-concurrent-commit.test.ts characterised it, 10 parallel requests, 12 events). The daily spend ceiling (0223) bounds the money, not who gets it; one scripted burst can use the day's
-- whole budget. The credit path already closed this with one conditional statement (0035, spend_credits_atomic); the free allowance is the one counted gate that was still check-then-act.
--
-- WHAT THIS DOES. A claim is taken BEFORE the model call, in one locked step:
--   claim_farah_free_message(user, allowance, window_days, hold_seconds)
--        takes a per-account advisory lock, sweeps THIS account's expired claims, counts committed free messages in the window (credit_gate_events, reason farah_chat_message, outcome
--        covered_by_free_allowance) PLUS unexpired pending claims in ONE statement (one snapshot), and only if that count is below the allowance records a pending claim. A request that loses is refused
--        here, before any model call; the app then treats it exactly as an account whose free messages are used up (Pass, credits, or the same refusal).
--   commit_farah_free_claim(claim, user, credits_available)
--        after a reply that COMPLETED: in one statement, removes the claim and writes the same free-allowance event the app has always written (so every reader of that event, the count, the next-free date,
--        the history route, the analytics, is unchanged). A claim that had already expired is removed and records nothing: its slot may have been given to someone else.
--   release_farah_free_claim(claim, user)
--        after a reply that did NOT complete (a failure, a cut-off, a reader that went away): removes the claim, so a message that never happened never uses a free slot.
-- A claim nobody settles (a crashed function, a lost connection) EXPIRES by itself after hold_seconds (default 120, above the roughly 60 seconds a reply can take): the count ignores it from then on and the
-- next claim for the account sweeps it. No cleanup job is needed.
--
-- WHAT IT DOES NOT CHANGE. credit_gate_events, its policies and its grants, 0223's counter and 0235's alert objects are not touched. The Pass's daily fair-use cap is the same check-then-commit shape and is
-- NOT part of this migration. Rows already over-committed before this runs stay as they are (the next-free date handles them, foundation PR).
--
-- THE ONE EXISTING OBJECT IT CHANGES: the test-user pool's reset (reset_test_pool_user, 0188, 0201, 0212). A pooled test identity is REUSED, and a reused identity must not inherit a pending claim, which
-- would count against its next claimer's allowance for up to hold_seconds. So the reset's table list gets one more row, ('farah_free_claims', 'user_id'), and nothing else about the function changes. It is
-- applied the way 0212 patches the same function: the function's CURRENT definition is read from the catalogue, ONE anchor line (the farah_messages row of the list) must be found exactly once and is
-- replaced by itself preceded by the new row, and the function is recreated. Because it patches what is live at the moment it runs, it cannot revert anything that landed in between, and the function keeps
-- its SECURITY DEFINER setting, its pinned search_path, its owner and its grants (the migration compares all four before and after and fails if any differ). The rollback removes that one row the same way.
--
-- SERVER ONLY. The table has row level security on and no policy, every privilege revoked from everyone, and select, insert and delete (not update) granted to service_role only. All three functions are SECURITY
-- INVOKER with an empty search_path and executable by service_role only: the account id is an argument, so granting it to a client role would let that client spend someone else's slot.
--
-- ADDITIVE and applied BEFORE the code that uses it merges. Code that reaches production first finds the function missing, logs one loud content-free line and falls back to the old check-then-commit path
-- (the free allowance keeps working, without the protection), rather than turning every free message into a paid one.
--
-- ROLLBACK is supabase/rollbacks/0236_farah_free_claims.rollback.sql: it drops the three functions and then the table. Take the claim code off first (code that still claims after the rollback finds the
-- function missing and falls back to the old path).

create table public.farah_free_claims (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint farah_free_claims_expiry_after_claim check (expires_at > claimed_at)
);

create index farah_free_claims_user_idx on public.farah_free_claims (user_id, expires_at);

comment on table public.farah_free_claims is
  'Server-only. A pending claim on one of an account''s free Farah messages (0236): taken before the model call, committed into a credit_gate_events free-allowance event after a completed reply, released after one that did not complete, expired by itself after its hold. Written only through claim_farah_free_message, commit_farah_free_claim and release_farah_free_claim, by service_role.';

alter table public.farah_free_claims enable row level security;
revoke all on table public.farah_free_claims from public, anon, authenticated, service_role;
grant select, insert, delete on table public.farah_free_claims to service_role;

create or replace function public.claim_farah_free_message(p_user_id uuid, p_allowance integer default 3, p_window_days integer default 30, p_hold_seconds integer default 120)
returns table (ok boolean, claim_id uuid, used integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_used integer;
  v_id   uuid;
begin
  if p_user_id is null then
    raise exception 'claim_farah_free_message: account missing' using errcode = '22023';
  end if;
  if p_allowance is null or p_allowance < 1 or p_allowance > 10 then
    raise exception 'claim_farah_free_message: allowance out of range' using errcode = '22023';
  end if;
  if p_window_days is null or p_window_days < 1 or p_window_days > 400 then
    raise exception 'claim_farah_free_message: window out of range' using errcode = '22023';
  end if;
  if p_hold_seconds is null or p_hold_seconds < 10 or p_hold_seconds > 600 then
    raise exception 'claim_farah_free_message: hold out of range' using errcode = '22023';
  end if;

  -- One account, one claimer at a time: a second claim for the same account waits here and then counts the state the first one left (it takes a new snapshot after the lock).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('farah_free_claim:' || p_user_id::text, 0));

  delete from public.farah_free_claims where user_id = p_user_id and expires_at <= pg_catalog.now();

  -- ONE statement, so the two counts come from one snapshot: a commit that moves a claim into an event between two separate counts could otherwise be missed or counted twice.
  select (select pg_catalog.count(*) from public.credit_gate_events e
           where e.user_id = p_user_id
             and e.reason = 'farah_chat_message'
             and e.outcome = 'covered_by_free_allowance'
             and e.created_at >= pg_catalog.now() - pg_catalog.make_interval(days => p_window_days))
       + (select pg_catalog.count(*) from public.farah_free_claims c
           where c.user_id = p_user_id and c.expires_at > pg_catalog.now())
    into v_used;

  if v_used < p_allowance then
    insert into public.farah_free_claims (user_id, expires_at) values (p_user_id, pg_catalog.now() + pg_catalog.make_interval(secs => p_hold_seconds)) returning id into v_id;
    return query select true, v_id, v_used + 1;
  else
    return query select false, null::uuid, v_used;
  end if;
end;
$$;

revoke all on function public.claim_farah_free_message(uuid, integer, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_farah_free_message(uuid, integer, integer, integer) to service_role;

create or replace function public.commit_farah_free_claim(p_claim_id uuid, p_user_id uuid, p_credits_available integer)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_done integer;
begin
  if p_claim_id is null or p_user_id is null or p_credits_available is null or p_credits_available < 0 then
    raise exception 'commit_farah_free_claim: bad argument' using errcode = '22023';
  end if;

  -- One statement: the claim is removed, and the event is written from it only if it had not expired. An expired claim is removed and records nothing.
  with c as (delete from public.farah_free_claims where id = p_claim_id and user_id = p_user_id returning expires_at)
  insert into public.credit_gate_events (user_id, reason, credits_required, credits_available, outcome)
  select p_user_id, 'farah_chat_message'::public.credit_reason, 0, p_credits_available, 'covered_by_free_allowance'::public.credit_gate_outcome from c where c.expires_at > pg_catalog.now()
  returning 1 into v_done;

  return v_done is not null;
end;
$$;

revoke all on function public.commit_farah_free_claim(uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.commit_farah_free_claim(uuid, uuid, integer) to service_role;

create or replace function public.release_farah_free_claim(p_claim_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_released integer;
begin
  if p_claim_id is null or p_user_id is null then
    raise exception 'release_farah_free_claim: bad argument' using errcode = '22023';
  end if;

  delete from public.farah_free_claims where id = p_claim_id and user_id = p_user_id returning 1 into v_released;

  return v_released is not null;
end;
$$;

revoke all on function public.release_farah_free_claim(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.release_farah_free_claim(uuid, uuid) to service_role;

-- The test-pool reset also clears this table: ONE row added to the function's table list, patched from its live definition (see the header). Nothing else about the function changes.
do $reset$
declare
  v_oid    oid := 'public.reset_test_pool_user(uuid, text)'::regprocedure;
  v_def    text;
  v_new    text;
  v_cnt    integer;
  v_acl    text;
  v_owner  oid;
  v_conf   text[];
  v_secdef boolean;
  c_anchor constant text := E'      (''farah_messages'', ''user_id''),\n';
  c_row    constant text := E'      (''farah_free_claims'', ''user_id''),\n';
begin
  select pg_catalog.pg_get_functiondef(oid), proacl::text, proowner, proconfig, prosecdef into v_def, v_acl, v_owner, v_conf, v_secdef from pg_catalog.pg_proc where oid = v_oid;
  if position(c_row in v_def) = 0 then
    v_cnt := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, c_anchor, ''))) / pg_catalog.length(c_anchor);
    if v_cnt <> 1 then
      raise exception '0236: reset_test_pool_user: the anchor line was found % times (it must be found exactly once)', v_cnt;
    end if;
    v_new := pg_catalog.replace(v_def, c_anchor, c_row || c_anchor);
    execute v_new;
  end if;
  if (select proacl::text is distinct from v_acl or proowner <> v_owner or proconfig is distinct from v_conf or prosecdef <> v_secdef from pg_catalog.pg_proc where oid = v_oid) then
    raise exception '0236: reset_test_pool_user changed its owner, grants, search_path or security setting';
  end if;
end
$reset$;

-- Checks itself when it is applied: the apply fails, and nothing is kept, if a client role can execute any of the three functions or touch the table, if PUBLIC can execute any of them, if service_role
-- lost any of them or cannot read and write the free-allowance events, if any is SECURITY DEFINER, if the table has no row level security or has a policy, or if the test-pool reset is not the same function
-- (same security setting, search_path, no client role or PUBLIC able to execute it, service_role able to) carrying 0201's and 0212's additions and wiping this table exactly once.
do $check$
declare
  v_claim   oid := 'public.claim_farah_free_message(uuid, integer, integer, integer)'::regprocedure;
  v_commit  oid := 'public.commit_farah_free_claim(uuid, uuid, integer)'::regprocedure;
  v_release oid := 'public.release_farah_free_claim(uuid, uuid)'::regprocedure;
  v_table   oid := 'public.farah_free_claims'::regclass;
  v_fn      oid;
  r         name;
begin
  foreach v_fn in array array[v_claim, v_commit, v_release] loop
    foreach r in array array['anon', 'authenticated'] loop
      if pg_catalog.has_function_privilege(r, v_fn, 'execute') then
        raise exception '0236 self-check: % can execute %', r, v_fn::regprocedure;
      end if;
    end loop;
    if exists (select 1 from pg_catalog.aclexplode(coalesce((select proacl from pg_catalog.pg_proc where oid = v_fn), pg_catalog.acldefault('f', (select proowner from pg_catalog.pg_proc where oid = v_fn)))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '0236 self-check: PUBLIC can execute %', v_fn::regprocedure;
    end if;
    if not pg_catalog.has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0236 self-check: service_role cannot execute %', v_fn::regprocedure;
    end if;
    if (select prosecdef from pg_catalog.pg_proc where oid = v_fn) then
      raise exception '0236 self-check: % must be SECURITY INVOKER', v_fn::regprocedure;
    end if;
  end loop;
  foreach r in array array['anon', 'authenticated'] loop
    if pg_catalog.has_table_privilege(r, v_table, 'select, insert, update, delete, truncate, references, trigger') then
      raise exception '0236 self-check: % holds a privilege on public.farah_free_claims', r;
    end if;
  end loop;
  if not pg_catalog.has_table_privilege('service_role', 'public.credit_gate_events', 'select') then
    raise exception '0236 self-check: service_role cannot select from public.credit_gate_events, which claim_farah_free_message needs';
  end if;
  if not pg_catalog.has_table_privilege('service_role', 'public.credit_gate_events', 'insert') then
    raise exception '0236 self-check: service_role cannot insert into public.credit_gate_events, which commit_farah_free_claim needs';
  end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid = v_table) then
    raise exception '0236 self-check: RLS is not enabled on public.farah_free_claims';
  end if;
  -- the test-pool reset: still the same function (SECURITY DEFINER, search_path = public, no client role or PUBLIC can execute it, service_role can), still carrying 0201's and 0212's additions, and now wiping this table
  if not exists (select 1 from pg_catalog.pg_proc where oid = 'public.reset_test_pool_user(uuid, text)'::regprocedure and prosecdef and proconfig = array['search_path=public']) then
    raise exception '0236 self-check: reset_test_pool_user is not SECURITY DEFINER with search_path = public';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if pg_catalog.has_function_privilege(r, 'public.reset_test_pool_user(uuid, text)'::regprocedure, 'execute') then
      raise exception '0236 self-check: % can execute reset_test_pool_user', r;
    end if;
  end loop;
  if exists (select 1 from pg_catalog.aclexplode(coalesce((select proacl from pg_catalog.pg_proc where oid = 'public.reset_test_pool_user(uuid, text)'::regprocedure), pg_catalog.acldefault('f', (select proowner from pg_catalog.pg_proc where oid = 'public.reset_test_pool_user(uuid, text)'::regprocedure)))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception '0236 self-check: PUBLIC can execute reset_test_pool_user';
  end if;
  if not pg_catalog.has_function_privilege('service_role', 'public.reset_test_pool_user(uuid, text)'::regprocedure, 'execute') then
    raise exception '0236 self-check: service_role cannot execute reset_test_pool_user';
  end if;
  if (select pg_catalog.length(prosrc) - pg_catalog.length(pg_catalog.replace(prosrc, E'(''farah_free_claims'', ''user_id'')', '')) from pg_catalog.pg_proc where oid = 'public.reset_test_pool_user(uuid, text)'::regprocedure) <> pg_catalog.length(E'(''farah_free_claims'', ''user_id'')') then
    raise exception '0236 self-check: reset_test_pool_user does not wipe farah_free_claims exactly once';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc where oid = 'public.reset_test_pool_user(uuid, text)'::regprocedure and prosrc like '%delete from public.mentor_payouts where mentor_id = p_user_id%' and prosrc like '%delete from public.account_deletions where profile_id = p_user_id%' and prosrc like '%deletion_requested_at = null%') then
    raise exception '0236 self-check: reset_test_pool_user lost an earlier addition (0201 or 0212)';
  end if;
  if exists (select 1 from pg_catalog.pg_policy where polrelid = v_table) then
    raise exception '0236 self-check: public.farah_free_claims has a policy (it must have none)';
  end if;
end
$check$;
