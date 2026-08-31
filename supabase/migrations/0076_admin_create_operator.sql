-- 0076 — creating an operator from the UI, database-enforced like the rest.
--
-- 0075 made every operator/role MUTATION re-check the actor inside the same
-- statement that writes: admin_set_operator, admin_upsert_role,
-- admin_delete_role. Adding an operator was still a plain insert from a Server
-- Action, guarded only in the app — which would have made it the one privilege
-- change in this area that the database does not police, and the one that
-- creates the privilege in the first place.
--
-- NO COVERAGE CHECK HERE, deliberately. The invariant 0075 protects is that at
-- least one active operator holds `operators`; ADDING an operator can only
-- ever increase coverage, never reduce it. Taking the mutex would cost a lock
-- on every invite to protect against a direction the operation cannot move in.
-- Stated rather than left as an omission somebody has to re-derive.
--
-- The auth.users row is NOT created here. It is created by Supabase's invite
-- API, outside SQL, and the caller passes the resulting id in. That split is
-- forced: GoTrue owns the auth schema, and the service role cannot write to it
-- (0067, 0068). The trigger `on_auth_user_created` — AFTER INSERT ON auth.users
-- FOR EACH ROW, no WHEN clause — fires for an invite exactly as it does for a
-- signup, so `profiles` exists by the time this runs. Verified rather than
-- assumed: an invite-created account was checked to have its profiles row and
-- to satisfy the FK an admin_users insert needs.

create or replace function public.admin_create_operator(
  p_actor uuid,
  p_user_id uuid,
  p_email text,
  p_display_name text,
  p_role_id uuid
)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.admin_has_permission(p_actor, 'operators') then
    return query select false, 'not_authorised'::text; return;
  end if;

  if p_role_id is null or not exists (select 1 from public.admin_roles where id = p_role_id) then
    return query select false, 'unknown_role'::text; return;
  end if;

  -- Already an operator. Reported rather than silently re-pointed: changing
  -- somebody's role is admin_set_operator's job, and an invite form that
  -- quietly reassigned an existing colleague would be a surprising way to
  -- discover that.
  if exists (select 1 from public.admin_users where id = p_user_id) then
    return query select false, 'already_admin'::text; return;
  end if;
  if exists (select 1 from public.admin_users where email = lower(btrim(p_email))) then
    return query select false, 'email_taken'::text; return;
  end if;

  insert into public.admin_users (id, email, display_name, role_id, role)
  values (
    p_user_id,
    -- Folded. The unique index is on lower(email) and the failed-login audit
    -- lookup matches on equality — see src/lib/admin/actions.ts.
    lower(btrim(p_email)),
    nullif(btrim(coalesce(p_display_name, '')), ''),
    p_role_id,
    -- The deprecated text column, kept in step for as long as it exists.
    case when exists (select 1 from public.admin_role_permissions arp
                       where arp.role_id = p_role_id and arp.permission = 'operators')
         then 'super_admin' else 'standard' end
  );

  return query select true, 'ok'::text;
end;
$$;

revoke all on function public.admin_create_operator(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_create_operator(uuid, uuid, text, text, uuid) to service_role;
