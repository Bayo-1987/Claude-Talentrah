-- 0073 — two-tier operator roles: super_admin and standard.
--
-- WHY A COLUMN ON admin_users AND NOT A NEW TABLE. 0060 chose a separate
-- admin_users table over a flag on `profiles` because `profiles` is the table
-- whose grant list exists to grow. That argument does not apply here: this
-- column is on the table that already IS the admin boundary, is unreachable by
-- any client (see the grant note below), and a roles table would add a join to
-- every request for a value with exactly two states.
--
-- EXISTING ROWS BACKFILL TO super_admin, DELIBERATELY. They have full access
-- today. Defaulting them to 'standard' would be a silent demotion of live
-- operators dressed up as a default — this migration preserves current
-- behaviour and grants nothing new. The column default is 'standard' so that
-- anything created AFTER this is least-privileged unless promoted on purpose;
-- the two are different questions and get different answers.
--
-- NO NEW GRANTS ARE NEEDED, and none are added. 0060 did
-- `revoke all on public.admin_users from anon, authenticated`, so no client
-- role can read or write any column of this table, this one included. The
-- column-privilege hazard CLAUDE.md documents (a permissive UPDATE policy
-- letting an owner rewrite every column on their own row) cannot arise here
-- because there is no client-reachable path at all. tests/rls/admin-roles
-- asserts that rather than trusting it.

alter table public.admin_users
  add column role text not null default 'standard'
  constraint admin_users_role_check check (role in ('super_admin', 'standard'));

-- Everyone who already had access keeps exactly what they had.
update public.admin_users set role = 'super_admin';

comment on column public.admin_users.role is
  'super_admin may manage other operators (roles, enable/disable); standard may not. Enforced by requireSuperAdmin() in the app and by admin_update_operator() in the database. Backfilled to super_admin in 0073 for rows that predate it.';


-- ── The one statement that may change an operator's role or enabled state ──
--
-- A READ-THEN-WRITE HERE HAS THE SAME RACE SHAPE AS spendCredits DID (0035).
-- Two super admins demoting each other at the same moment would both read
-- "there are 2 of us, so removing one is fine" and both commit, leaving zero.
-- Nobody could then reach /admin/operators to undo it, because the page that
-- fixes it is the page the guard just locked.
--
-- So the check and the act happen together, under a lock, the same way
-- auto_apply_claim_submission (0034) holds several conditions at once:
--
--   perform ... for update   locks every currently-active super admin row,
--                            which is precisely the set this function can
--                            shrink. A second caller blocks here, and when it
--                            resumes, Postgres re-evaluates the predicate
--                            against the committed row versions — so a row the
--                            first caller demoted is no longer in the second
--                            caller's set, and its count is the real one.
--
-- Both parameters are optional. Null means "leave this alone", so one function
-- covers a role change, an enable, and a disable — and the invariant is
-- expressed once instead of three times, which is the only reason they share a
-- function rather than reading more clearly as three.
create or replace function public.admin_update_operator(
  p_actor uuid,
  p_target uuid,
  p_role text default null,
  p_disabled boolean default null
)
returns table (ok boolean, reason text, new_role text, new_disabled_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_ok boolean;
  v_target public.admin_users%rowtype;
  v_role text;
  v_disabled_at timestamptz;
  v_others integer;
  v_target_active_super boolean;
begin
  if p_role is not null and p_role not in ('super_admin', 'standard') then
    return query select false, 'bad_role'::text, null::text, null::timestamptz;
    return;
  end if;

  -- THE MUTEX. Every active super admin, which is exactly the set that must
  -- not reach zero. Taken before anything is read, so the counts below are
  -- taken in a world where no other caller can be halfway through shrinking it.
  perform 1 from public.admin_users
   where role = 'super_admin' and disabled_at is null
   for update;

  -- The actor must be an active super admin. Checked HERE as well as in
  -- requireSuperAdmin() — not because the app guard is doubted, but because a
  -- SECURITY DEFINER function that trusts its caller is one refactor away from
  -- being the hole. The app guard is what a person hits; this is what the
  -- function guarantees to anyone who ever calls it.
  select (a.role = 'super_admin' and a.disabled_at is null) into v_actor_ok
    from public.admin_users a where a.id = p_actor;
  if v_actor_ok is distinct from true then
    return query select false, 'not_authorised'::text, null::text, null::timestamptz;
    return;
  end if;

  select * into v_target from public.admin_users where id = p_target;
  if not found then
    return query select false, 'not_found'::text, null::text, null::timestamptz;
    return;
  end if;

  v_role := coalesce(p_role, v_target.role);
  if p_disabled is null then
    v_disabled_at := v_target.disabled_at;
  elsif p_disabled then
    -- Re-disabling an already-disabled operator must not move the timestamp;
    -- that date is the record of when access was actually taken away.
    v_disabled_at := coalesce(v_target.disabled_at, now());
  else
    v_disabled_at := null;
  end if;

  -- Nothing would change. Reported rather than logged as an action, so the
  -- audit trail does not fill with no-ops.
  if v_role = v_target.role and v_disabled_at is not distinct from v_target.disabled_at then
    return query select false, 'no_change'::text, v_target.role, v_target.disabled_at;
    return;
  end if;

  -- THE INVARIANT: at least one active super admin must survive this.
  select count(*) into v_others from public.admin_users
   where role = 'super_admin' and disabled_at is null and id <> p_target;
  v_target_active_super := (v_role = 'super_admin' and v_disabled_at is null);

  if v_others = 0 and not v_target_active_super then
    return query select false, 'last_super_admin'::text, v_target.role, v_target.disabled_at;
    return;
  end if;

  update public.admin_users
     set role = v_role, disabled_at = v_disabled_at
   where id = p_target;

  -- Disabling revokes live sessions in the SAME transaction. Disabling alone
  -- already locks them out (admin_session_validate joins admin_users and
  -- refuses a disabled one), but leaving live rows behind makes "who is signed
  -- in right now" wrong and leans on that join staying correct forever. Same
  -- reasoning, and the same two steps, as scripts/grant-admin.ts --revoke.
  if v_disabled_at is not null and v_target.disabled_at is null then
    update public.admin_sessions
       set revoked_at = now()
     where admin_user_id = p_target and revoked_at is null;
  end if;

  return query select true, 'ok'::text, v_role, v_disabled_at;
end;
$$;

-- Same posture as every other admin surface: the service role calls this, no
-- client role can. Revoked explicitly rather than relying on the default,
-- because a function's default EXECUTE grant is to PUBLIC.
revoke all on function public.admin_update_operator(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_update_operator(uuid, uuid, text, boolean) to service_role;
