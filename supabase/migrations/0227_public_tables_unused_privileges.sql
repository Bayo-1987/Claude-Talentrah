-- 0227: anon and authenticated no longer hold TRUNCATE, REFERENCES, TRIGGER or MAINTAIN on any public table, tables the postgres role creates later are created without them, and two referral functions are no longer executable by them.
--
-- WHAT. (1) Supabase's default privileges give every new public table all privileges for anon, authenticated and service_role. The Data API (PostgREST) only issues SELECT, INSERT, UPDATE and DELETE, so the app never uses these four, and unlike those
-- four they are not limited by row-level security. This revokes them from anon and authenticated on every existing public table (ordinary and partitioned; MAINTAIN exists from PostgreSQL 17 and is left out of the list on an older server) and removes
-- them from the default privileges of the postgres role in schema public, so a table the postgres role creates later does not get them again. (2) EXECUTE on count_rewarded_referrals_last_30d(uuid, uuid) and check_and_activate_referral(uuid) is
-- revoked from anon and authenticated: production already has it this way, so this is a no-op there and brings a database built from the repo (CI, a rebuilt project) to the same state.
--
-- NOT CHANGED. service_role and the table owner; SELECT, INSERT, UPDATE and DELETE on any table (the review of anon's write grants is a separate migration); column-level grants other than REFERENCES (revoking REFERENCES on a table also clears it on
-- each column); other functions and sequences. The default privileges of every OTHER role are not altered, in particular supabase_admin's, which still hand all privileges on tables it creates in public to anon and authenticated: a table created by
-- supabase_admin (for example from the dashboard) would not be covered, and the post-apply check lists any public table not owned by postgres.
--
-- ALSO ADDED. public.table_privilege_snapshot(), callable by service_role only, returns the table-level, column-level, default and function-EXECUTE privileges that anon, authenticated and PUBLIC hold, read from the catalogs with aclexplode, so a
-- database-backed test can hold this. data_api_grants_snapshot() (0193) stays as it is.

do $a$
declare
  r record;
  privs text := case when current_setting('server_version_num')::int >= 170000 then 'truncate, references, trigger, maintain' else 'truncate, references, trigger' end;
begin
  for r in select c.oid::regclass::text as t from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') loop
    execute format('revoke %s on table %s from anon, authenticated', privs, r.t);
  end loop;
  execute format('alter default privileges for role postgres in schema public revoke %s on tables from anon, authenticated', privs);
end
$a$;

revoke execute on function public.count_rewarded_referrals_last_30d(uuid, uuid) from anon, authenticated;
revoke execute on function public.check_and_activate_referral(uuid) from anon, authenticated;

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

-- Self-check: the migration fails (and rolls back) if any of the four is still held by anon, authenticated or PUBLIC on a public table, at column level, or in the postgres role's default privileges for schema public, or if either referral function is still
-- executable by them.
do $check$
declare
  n bigint;
  who text;
begin
  select count(*), string_agg(distinct s.source || ':' || s.object_name || ':' || s.grantee || ':' || s.privilege_type, ', ')
    into n, who
    from public.table_privilege_snapshot() s
   where (s.source in ('table', 'column') and s.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'))
      or (s.source = 'default' and s.object_name = 'role postgres, schema public' and s.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'))
      or (s.source = 'function' and s.privilege_type = 'EXECUTE' and s.grantee in ('anon', 'authenticated')
          and s.object_name in ('count_rewarded_referrals_last_30d(p_referrer_id uuid, p_exclude_referral_id uuid)', 'check_and_activate_referral(p_user_id uuid)'));
  if n <> 0 then
    raise exception '0227: % grant(s) remain: %', n, left(who, 600);
  end if;
  if not has_table_privilege('service_role', 'public.profiles', 'TRUNCATE')
     or not has_function_privilege('service_role', 'public.count_rewarded_referrals_last_30d(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.check_and_activate_referral(uuid)', 'EXECUTE') then
    raise exception '0227: service_role lost a privilege it must keep';
  end if;
end
$check$;
