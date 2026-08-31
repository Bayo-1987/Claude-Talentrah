-- 0081 — who may flip a flag, and the one statement that lets them.
--
-- Separate from 0080 because Postgres will not let a new enum value be used in
-- the transaction that adds it (55P04). Same split as 0077/0078.
--
-- ── WHO GETS IT ──────────────────────────────────────────────────────────
--
-- Both builtin roles, matching how 0075 seeded every content area and how 0078
-- handled `blog`: Super Admin gets the whole enum, Standard Admin everything
-- except `operators`. That is a judgment call rather than an obvious one — a
-- flag decides what real users receive, which is a bigger lever than editing a
-- course row — but breaking the "Standard Admin is everything except
-- operators" definition silently is worse than the risk, and since 0075 the
-- role editor can narrow it in a few clicks with an audit row to show for it.
--
-- CUSTOM roles get nothing here, deliberately. Their permission sets were
-- chosen by a person, and silently widening them would make "this role can do
-- exactly these things" untrue the moment a new area ships.

insert into public.admin_role_permissions (role_id, permission)
select r.id, 'feature_flags'::public.admin_permission
  from public.admin_roles r
 where r.is_builtin
on conflict do nothing;


-- ── the one statement that may flip a flag ───────────────────────────────
--
-- The permission check and the write are the same statement, so no future code
-- path can perform one without the other. Same shape as 0079's four content
-- functions, and the same honest caveat: this stops a code path that forgets
-- to ask, NOT a compromised service_role key, which can UPDATE this table
-- directly regardless. Only revoking service_role's table privileges would
-- change that, and it would break the digest cron that has to read it.
--
-- NO MUTEX. 0075's operator functions take a lock because they defend a
-- cross-table invariant. A flag has none — it is a single row with two states
-- — so a flat permission check is the whole job.
create or replace function public.admin_set_feature_flag(
  p_actor uuid,
  p_key text,
  p_enabled boolean
)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare v_updated text;
begin
  if not public.admin_has_permission(p_actor, 'feature_flags') then
    return query select false, 'not_authorised'::text; return;
  end if;
  if p_enabled is null then
    return query select false, 'bad_state'::text; return;
  end if;

  update public.feature_flags
     set enabled = p_enabled,
         updated_by = p_actor,
         updated_at = now()
   where key = p_key
  returning key into v_updated;

  if v_updated is null then
    -- Flags are created by migration, not by this screen: a typo'd key that
    -- silently created a flag nothing reads would be worse than a refusal.
    return query select false, 'unknown_flag'::text; return;
  end if;
  return query select true, 'ok'::text;
end;
$$;

revoke all on function public.admin_set_feature_flag(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_feature_flag(uuid, text, boolean) to service_role;
