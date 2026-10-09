-- 0227 (remainder): anon and authenticated no longer hold MAINTAIN on any public table (PostgreSQL 17 and later), two referral functions are no longer executable by them, and a service-role-only snapshot function reads the privileges back.
--
-- SCOPE. 0227 was first written to revoke TRUNCATE, REFERENCES, TRIGGER and MAINTAIN. 0239 (applied on both projects on 7 Oct 2026) already revoked the first three, so what is left is: (a) MAINTAIN, which exists from PostgreSQL 17
-- (VACUUM, ANALYZE, REINDEX, CLUSTER, REFRESH MATERIALIZED VIEW, LOCK TABLE; the Data API sends none of them and, like TRUNCATE, it is not limited by row level security): the read-only audit of 8 Oct 2026 found preview on PostgreSQL 17.0.6
-- with anon or authenticated holding it on 55 tables, and the postgres role's default privileges still hand it to both roles. The revoke is built from the server version, so on an older server (no such privilege) it does nothing.
-- (b) EXECUTE on count_rewarded_referrals_last_30d(uuid, uuid) and check_and_activate_referral(uuid) is revoked from anon, authenticated and PUBLIC; both projects already have it this way (audit of 8 Oct 2026), so this is a no-op there and brings a
-- database built from the repo (CI, a rebuilt project) to the same state. (c) public.table_privilege_snapshot(), callable by service_role only, returns the table-level, column-level, default and function-EXECUTE privileges that anon,
-- authenticated and PUBLIC hold, read from the catalogs with aclexplode, so a database-backed test can hold the rules. data_api_grants_snapshot() (0193) stays as it is.
--
-- NOT CHANGED. service_role and the table owner; SELECT, INSERT, UPDATE and DELETE on any table (anon's writes are 0229); other functions and sequences. The default privileges of every OTHER role are attempted for MAINTAIN and, where the
-- migrating role may not change them (supabase_admin's), reported and skipped, as in 0239.

do $m$
declare
  t record;
  d record;
  v_pg17 constant boolean := current_setting('server_version_num')::int >= 170000;
  v_before_other bigint;
  v_after_other bigint;
  v_left text;
begin
  if v_pg17 then
    -- What must not change: SELECT, INSERT, UPDATE, DELETE and the three 0239 revoked, for the two client roles, and every privilege of service_role (MAINTAIN included).
    select count(*) into v_before_other from pg_catalog.pg_class c cross join unnest(array['anon', 'authenticated']) r cross join unnest(array['select', 'insert', 'update', 'delete']) p
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_catalog.has_table_privilege(r, c.oid, p);
    v_before_other := v_before_other + (select count(*) from pg_catalog.pg_class c cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger', 'maintain']) p
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_catalog.has_table_privilege('service_role', c.oid, p));

    for t in
      select pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname) as tbl
        from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')
       order by c.relname
    loop
      execute pg_catalog.format('revoke maintain on table %s from public, anon, authenticated', t.tbl);
    end loop;

    alter default privileges in schema public revoke maintain on tables from anon, authenticated;
    for d in
      select distinct pg_catalog.pg_get_userbyid(a.defaclrole) as grantor
        from pg_catalog.pg_default_acl a
       where a.defaclnamespace = 'public'::regnamespace and a.defaclobjtype = 'r' and pg_catalog.pg_get_userbyid(a.defaclrole) <> current_user
    loop
      begin
        execute pg_catalog.format('alter default privileges for role %I in schema public revoke maintain on tables from anon, authenticated', d.grantor);
      exception when insufficient_privilege then
        raise notice '0227: the default privileges of role % were not changed (the migrating role may not change them)', d.grantor;
      end;
    end loop;

    select string_agg(c.relname || ': ' || r, ', ' order by c.relname, r) into v_left
      from pg_catalog.pg_class c cross join unnest(array['anon', 'authenticated']) r
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_catalog.has_table_privilege(r, c.oid, 'maintain');
    if v_left is not null then raise exception '0227 self-check: a client role still holds MAINTAIN: %', left(v_left, 600); end if;
    if exists (
      select 1 from pg_catalog.pg_default_acl x cross join lateral pg_catalog.aclexplode(x.defaclacl) a
       where x.defaclnamespace = 'public'::regnamespace and x.defaclobjtype = 'r' and pg_catalog.pg_get_userbyid(x.defaclrole) = current_user
         and a.grantee in (select oid from pg_catalog.pg_roles where rolname in ('anon', 'authenticated')) and a.privilege_type = 'MAINTAIN'
    ) then raise exception '0227 self-check: the default privileges of % still give MAINTAIN to a client role', current_user; end if;

    select count(*) into v_after_other from pg_catalog.pg_class c cross join unnest(array['anon', 'authenticated']) r cross join unnest(array['select', 'insert', 'update', 'delete']) p
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_catalog.has_table_privilege(r, c.oid, p);
    v_after_other := v_after_other + (select count(*) from pg_catalog.pg_class c cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger', 'maintain']) p
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_catalog.has_table_privilege('service_role', c.oid, p));
    if v_after_other <> v_before_other then raise exception '0227 self-check: another privilege changed (% before, % after)', v_before_other, v_after_other; end if;
  end if;
end
$m$;

revoke execute on function public.count_rewarded_referrals_last_30d(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.check_and_activate_referral(uuid) from public, anon, authenticated;

create or replace function public.table_privilege_snapshot()
returns table (source text, object_name text, grantee text, privilege_type text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select 'table'::text, c.relname::text, case g.grantee when 0 then 'public' else pg_get_userbyid(g.grantee) end, g.privilege_type::text
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     and (g.grantee = 0 or pg_get_userbyid(g.grantee) in ('anon', 'authenticated'))
  union all
  select 'column'::text, c.relname::text || '.' || a.attname::text, case g.grantee when 0 then 'public' else pg_get_userbyid(g.grantee) end, g.privilege_type::text
    from pg_class c
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null
    cross join lateral aclexplode(a.attacl) g
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     and (g.grantee = 0 or pg_get_userbyid(g.grantee) in ('anon', 'authenticated'))
  union all
  select 'default'::text, 'role ' || pg_get_userbyid(d.defaclrole) || ', schema ' || case d.defaclnamespace when 0 then '(all)' else d.defaclnamespace::regnamespace::text end,
         case g.grantee when 0 then 'public' else pg_get_userbyid(g.grantee) end, g.privilege_type::text
    from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) g
   where d.defaclobjtype = 'r' and (g.grantee = 0 or pg_get_userbyid(g.grantee) in ('anon', 'authenticated'))
  union all
  select 'function'::text, p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')', case g.grantee when 0 then 'public' else pg_get_userbyid(g.grantee) end, g.privilege_type::text
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and (g.grantee = 0 or pg_get_userbyid(g.grantee) in ('anon', 'authenticated'));
$$;

revoke all on function public.table_privilege_snapshot() from public, anon, authenticated;
grant execute on function public.table_privilege_snapshot() to service_role;

-- Self-check: the migration fails (and rolls back) if either referral function is still executable by anon, authenticated or PUBLIC, if the snapshot function is callable by a client role, or if service_role lost what it must keep.
do $check$
begin
  if has_function_privilege('anon', 'public.count_rewarded_referrals_last_30d(uuid, uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'public.count_rewarded_referrals_last_30d(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.check_and_activate_referral(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'public.check_and_activate_referral(uuid)', 'EXECUTE') then
    raise exception '0227 self-check: a referral function is still executable by anon or authenticated';
  end if;
  if has_function_privilege('anon', 'public.table_privilege_snapshot()', 'EXECUTE') or has_function_privilege('authenticated', 'public.table_privilege_snapshot()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.table_privilege_snapshot()', 'EXECUTE') then
    raise exception '0227 self-check: table_privilege_snapshot() must be callable by service_role only';
  end if;
  if not has_function_privilege('service_role', 'public.count_rewarded_referrals_last_30d(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.check_and_activate_referral(uuid)', 'EXECUTE') then
    raise exception '0227 self-check: service_role lost EXECUTE on a referral function';
  end if;
end
$check$;
