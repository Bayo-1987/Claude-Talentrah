-- 0074 — custom roles with granular permissions, replacing 0073's two fixed tiers.
--
-- 0073 put `role text check (role in ('super_admin','standard'))` on
-- admin_users. That was right for two tiers and wrong for any third, so this
-- moves to a role table, a fixed permission catalog, and a join.
--
-- ── WHAT DOES NOT CHANGE ─────────────────────────────────────────────────
--
-- Nothing, for the two accounts that exist. Two builtin roles are seeded with
-- exactly the permission sets 0073's tiers had, and both live operators are
-- backfilled to whichever matches their current `role` value. Anyone signing
-- in after this migration can do precisely what they could before it.
--
-- ── admin_users.role IS DEPRECATED, NOT DROPPED ──────────────────────────
--
-- Deliberately, and this is the 0071/0073 lesson applied a third time. The
-- deployed build reads `role`; the build that reads `role_id` is not live
-- until Vercel finishes. Dropping the column here would mean, for the length
-- of one deploy, code querying a column that does not exist. So both are
-- maintained until a later migration removes the old one — see the bridge at
-- the bottom of this file.
--
-- ── role_id IS NULLABLE, AND NULL MEANS NO PERMISSIONS ───────────────────
--
-- Not `not null default <Standard Admin>`. A default would silently grant
-- eight permissions to any row inserted by something that has not been taught
-- about roles yet — including the old grant-admin, which upserts without one.
-- Null granting nothing is the failure this system should have: an operator
-- who can sign in and do nothing is a visible, fixable mistake; an operator
-- who was quietly given the standard set is not.

-- ── the catalog ───────────────────────────────────────────────────────────
--
-- An enum rather than free text: these keys are matched one-to-one against
-- pages that exist, and a typo in a permission name is a permission that
-- silently grants nothing. Adding an area later is an `alter type ... add
-- value`, which is the point at which somebody should be thinking about it.
create type public.admin_permission as enum (
  'scholarships',
  'reported_postings',
  'ad_campaigns',
  'feedback',
  'courses',
  'operations',
  'finance',
  'people',
  -- The one that is not like the others: it does not open a content area, it
  -- confers the ability to manage operators and roles — including granting
  -- itself to somebody else. Every invariant below exists to protect it.
  'operators'
);

create table public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- Builtin roles may be renamed and re-permissioned like any other, but not
  -- deleted: they are what grant-admin and the backfill refer to by name, and
  -- a bootstrap path that can be deleted from the UI is a bootstrap path that
  -- will be.
  is_builtin boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.admin_role_permissions (
  role_id uuid not null references public.admin_roles(id) on delete cascade,
  permission public.admin_permission not null,
  primary key (role_id, permission)
);

alter table public.admin_users
  add column role_id uuid references public.admin_roles(id) on delete restrict;

-- ON DELETE RESTRICT, not SET NULL or CASCADE. Deleting a role that is still
-- assigned must fail loudly rather than quietly stripping someone's access or
-- removing the operator entirely; admin_delete_role refuses it in a nicer way
-- first, and this is the backstop for anything that goes around it.

create index admin_users_role_id_idx on public.admin_users (role_id);

-- ── isolation, identical to 0060's posture for admin_users ────────────────
alter table public.admin_roles enable row level security;
alter table public.admin_role_permissions enable row level security;
revoke all on public.admin_roles from anon, authenticated;
revoke all on public.admin_role_permissions from anon, authenticated;
-- RLS on with NO policies, plus every privilege revoked. Both, for the reason
-- tests/rls/admin-identity.test.ts spells out: a revoked privilege raises an
-- error, a policy matching no rows returns an empty array, and only one of
-- those is safe to mistake for the other.

-- ── seed the two builtin roles, matching 0073's tiers exactly ─────────────
insert into public.admin_roles (name, is_builtin) values
  ('Super Admin', true),
  ('Standard Admin', true);

insert into public.admin_role_permissions (role_id, permission)
select r.id, p.permission
from public.admin_roles r
cross join (select unnest(enum_range(null::public.admin_permission)) as permission) p
where r.name = 'Super Admin';

insert into public.admin_role_permissions (role_id, permission)
select r.id, p.permission
from public.admin_roles r
cross join (select unnest(enum_range(null::public.admin_permission)) as permission) p
where r.name = 'Standard Admin'
  and p.permission <> 'operators';

-- ── backfill: same access as before, decided by the old column ────────────
update public.admin_users u
   set role_id = r.id
  from public.admin_roles r
 where r.name = case u.role when 'super_admin' then 'Super Admin' else 'Standard Admin' end;


-- ── THE INVARIANT, EXPRESSED ONCE ────────────────────────────────────────
--
-- "At least one active operator holds a role granting `operators`."
--
-- 0073's version was "at least one active super admin", checked by computing
-- what the count WOULD be after a change. That worked for two mutation shapes.
-- There are now five — disable, reassign, edit a role's permissions, delete a
-- role, and create/rename — and hand-computing the post-state five times is
-- five chances to get the arithmetic wrong in a way that only shows up as a
-- lockout.
--
-- So instead: every mutation applies its change, calls THIS, and rolls back if
-- it comes back false. One expression of the rule, checked against the real
-- post-change state rather than a prediction of it.
create or replace function public.admin_operators_covered()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.admin_users u
      join public.admin_role_permissions p on p.role_id = u.role_id
     where u.disabled_at is null
       and p.permission = 'operators'
  );
$$;

-- Does this operator hold this permission? The app guard's counterpart.
create or replace function public.admin_has_permission(p_admin uuid, p_permission public.admin_permission)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.admin_users u
      join public.admin_role_permissions p on p.role_id = u.role_id
     where u.id = p_admin
       and u.disabled_at is null
       and p.permission = p_permission
  );
$$;


-- ── assign a role, enable, or disable ─────────────────────────────────────
create or replace function public.admin_set_operator(
  p_actor uuid,
  p_target uuid,
  p_role_id uuid default null,
  p_disabled boolean default null
)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.admin_users%rowtype;
  v_role_id uuid;
  v_disabled_at timestamptz;
begin
  -- THE MUTEX, and it is the whole admin_roles table rather than a set of
  -- admin_users rows. 0073 locked the active super-admin rows, which no longer
  -- suffices: a transaction editing a role's permissions and one reassigning
  -- an operator would lock different rows and both pass, leaving nobody with
  -- `operators`. Every mutation in this file takes this same lock, so all five
  -- shapes serialise against each other. The table has a handful of rows.
  perform 1 from public.admin_roles for update;

  if not public.admin_has_permission(p_actor, 'operators') then
    return query select false, 'not_authorised'::text; return;
  end if;

  select * into v_target from public.admin_users where id = p_target;
  if not found then
    return query select false, 'not_found'::text; return;
  end if;

  if p_role_id is not null and not exists (select 1 from public.admin_roles where id = p_role_id) then
    return query select false, 'unknown_role'::text; return;
  end if;

  v_role_id := coalesce(p_role_id, v_target.role_id);
  if p_disabled is null then
    v_disabled_at := v_target.disabled_at;
  elsif p_disabled then
    -- Re-disabling must not move the timestamp: that date is the record of
    -- when access was actually taken away.
    v_disabled_at := coalesce(v_target.disabled_at, now());
  else
    v_disabled_at := null;
  end if;

  if v_role_id is not distinct from v_target.role_id
     and v_disabled_at is not distinct from v_target.disabled_at then
    return query select false, 'no_change'::text; return;
  end if;

  begin
    update public.admin_users
       set role_id = v_role_id,
           disabled_at = v_disabled_at,
           -- THE BRIDGE. Kept in step for as long as `role` exists, so a
           -- build still reading it sees something true. A custom role has no
           -- text equivalent, so it maps by the only thing the old column was
           -- ever used to decide.
           role = case
                    when exists (select 1 from public.admin_role_permissions
                                  where role_id = v_role_id and permission = 'operators')
                    then 'super_admin' else 'standard' end
     where id = p_target;

    if v_disabled_at is not null and v_target.disabled_at is null then
      update public.admin_sessions
         set revoked_at = now()
       where admin_user_id = p_target and revoked_at is null;
    end if;

    if not public.admin_operators_covered() then
      -- Rolls back to the implicit savepoint this BEGIN opened, undoing the
      -- update above. A custom SQLSTATE rather than a message match, so a
      -- genuine error is never mistaken for the invariant firing.
      raise exception 'coverage' using errcode = 'TR001';
    end if;
  exception when sqlstate 'TR001' then
    return query select false, 'last_operator_admin'::text; return;
  end;

  return query select true, 'ok'::text;
end;
$$;


-- ── create or edit a role, permissions and all ────────────────────────────
create or replace function public.admin_upsert_role(
  p_actor uuid,
  p_role_id uuid,                       -- null to create
  p_name text,
  p_permissions public.admin_permission[]
)
returns table (ok boolean, reason text, role_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform 1 from public.admin_roles for update;

  if not public.admin_has_permission(p_actor, 'operators') then
    return query select false, 'not_authorised'::text, null::uuid; return;
  end if;
  if p_name is null or btrim(p_name) = '' then
    return query select false, 'name_required'::text, null::uuid; return;
  end if;

  begin
    if p_role_id is null then
      insert into public.admin_roles (name) values (btrim(p_name)) returning id into v_id;
    else
      update public.admin_roles set name = btrim(p_name) where id = p_role_id returning id into v_id;
      if v_id is null then
        return query select false, 'not_found'::text, null::uuid; return;
      end if;
      delete from public.admin_role_permissions where role_id = v_id;
    end if;

    insert into public.admin_role_permissions (role_id, permission)
    select v_id, unnest(coalesce(p_permissions, '{}'::public.admin_permission[]))
    on conflict do nothing;

    -- Editing a role can remove `operators` from the only role that had it.
    if not public.admin_operators_covered() then
      raise exception 'coverage' using errcode = 'TR001';
    end if;
  exception
    when sqlstate 'TR001' then
      return query select false, 'last_operator_admin'::text, null::uuid; return;
    when unique_violation then
      return query select false, 'name_taken'::text, null::uuid; return;
  end;

  return query select true, 'ok'::text, v_id;
end;
$$;


-- ── delete a role ─────────────────────────────────────────────────────────
create or replace function public.admin_delete_role(p_actor uuid, p_role_id uuid)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_builtin boolean;
  v_assigned integer;
begin
  perform 1 from public.admin_roles for update;

  if not public.admin_has_permission(p_actor, 'operators') then
    return query select false, 'not_authorised'::text; return;
  end if;

  select is_builtin into v_builtin from public.admin_roles where id = p_role_id;
  if not found then
    return query select false, 'not_found'::text; return;
  end if;
  if v_builtin then
    -- Builtins are what grant-admin and 0074's backfill name. A bootstrap path
    -- that can be deleted from the UI is one that eventually will be.
    return query select false, 'builtin'::text; return;
  end if;

  select count(*) into v_assigned from public.admin_users where role_id = p_role_id;
  if v_assigned > 0 then
    -- Refused rather than reassigning for them. Where those operators should
    -- land is a decision, and silently moving somebody's access is the kind of
    -- helpfulness nobody wants from an access-control screen.
    return query select false, 'role_in_use'::text; return;
  end if;

  begin
    delete from public.admin_roles where id = p_role_id;
    if not public.admin_operators_covered() then
      raise exception 'coverage' using errcode = 'TR001';
    end if;
  exception when sqlstate 'TR001' then
    return query select false, 'last_operator_admin'::text; return;
  end;

  return query select true, 'ok'::text;
end;
$$;


-- ── the bridge: 0073's function keeps working, and keeps role_id in step ──
--
-- The previously deployed build calls admin_update_operator with a text role.
-- It stays callable for the length of one deploy, but must not leave the two
-- columns disagreeing — so it now writes both.
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
  v_role_id uuid;
  v_res record;
begin
  if p_role is not null then
    select id into v_role_id from public.admin_roles
     where name = case p_role when 'super_admin' then 'Super Admin' else 'Standard Admin' end;
  end if;

  select * into v_res from public.admin_set_operator(p_actor, p_target, v_role_id, p_disabled);

  return query
    select v_res.ok,
           v_res.reason,
           (select role from public.admin_users where id = p_target),
           (select disabled_at from public.admin_users where id = p_target);
end;
$$;


-- ── grants: service role only, same as everything else under /admin ───────
revoke all on function public.admin_operators_covered() from public, anon, authenticated;
revoke all on function public.admin_has_permission(uuid, public.admin_permission) from public, anon, authenticated;
revoke all on function public.admin_set_operator(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.admin_upsert_role(uuid, uuid, text, public.admin_permission[]) from public, anon, authenticated;
revoke all on function public.admin_delete_role(uuid, uuid) from public, anon, authenticated;

grant execute on function public.admin_operators_covered() to service_role;
grant execute on function public.admin_has_permission(uuid, public.admin_permission) to service_role;
grant execute on function public.admin_set_operator(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.admin_upsert_role(uuid, uuid, text, public.admin_permission[]) to service_role;
grant execute on function public.admin_delete_role(uuid, uuid) to service_role;
