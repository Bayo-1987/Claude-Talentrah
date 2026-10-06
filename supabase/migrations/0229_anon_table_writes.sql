-- 0229: anon holds no INSERT, UPDATE or DELETE on any public table, and tables the postgres role creates later are created without them for anon.
--
-- WHAT. Supabase's default privileges give anon INSERT, UPDATE and DELETE on every new public table. Nothing signed-out writes through the anon role: every write the app makes without a session goes through the service role (a static scan of src
-- found no signed-out write through the session or browser client, and a sign-in guard sits in front of every session-client write), and row-level security has no policy that lets anon write (Phase 0). This revokes the three privileges, including any
-- column-level grant of INSERT or UPDATE, from anon on every public table (ordinary and partitioned), and removes them from the default privileges of the postgres role in schema public. SELECT is not changed.
--
-- NOT CHANGED. authenticated and service_role; SELECT for anon; PUBLIC (a grant to PUBLIC would still reach anon, and the standing test reports it); functions and sequences; the default privileges of every OTHER role (supabase_admin's still hand anon
-- INSERT, UPDATE and DELETE on tables that role creates in public, and the post-apply check lists any public table not owned by postgres).
--
-- ORDER. Independent of 0227 in effect; the standing test for this reads public.table_privilege_snapshot() from 0227, so it lands after 0227.

do $b$
declare
  r record;
begin
  for r in select c.oid::regclass::text as t from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') loop
    execute format('revoke insert, update, delete on table %s from anon', r.t);
  end loop;
  alter default privileges for role postgres in schema public revoke insert, update, delete on tables from anon;
end
$b$;

-- Self-check: the migration fails (and rolls back) if anon still holds any of the three on a public table (table level or column level) or in the postgres role's default privileges for schema public, or lost SELECT.
do $check$
declare
  n bigint;
  who text;
  anon_oid oid := (select oid from pg_roles where rolname = 'anon');
begin
  select count(*), string_agg(distinct s.what, ', ') into n, who from (
    select c.relname::text || ':' || g.privilege_type as what
      from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and g.grantee = anon_oid and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    union all
    select c.relname::text || '.' || a.attname::text || ':' || g.privilege_type
      from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null
      cross join lateral aclexplode(a.attacl) g
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and g.grantee = anon_oid and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    union all
    select 'default postgres:' || g.privilege_type
      from pg_default_acl d cross join lateral aclexplode(d.defaclacl) g
     where d.defaclobjtype = 'r' and d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and g.grantee = anon_oid and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')) s;
  if n <> 0 then
    raise exception '0229: % anon write grant(s) remain: %', n, left(who, 600);
  end if;
  if not has_any_column_privilege('anon', 'public.blog_posts', 'SELECT') then
    raise exception '0229: anon lost SELECT on public.blog_posts (public reads must stay)';
  end if;
end
$check$;
