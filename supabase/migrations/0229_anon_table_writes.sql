-- 0229: anon holds no INSERT, UPDATE or DELETE on any table in schema public, and new tables are no longer created with them for anon.
--
-- WHAT. Supabase hands every new table in public to anon with INSERT, UPDATE and DELETE (and SELECT). Nothing signed-out writes through the anon role: every write the application makes without a session
-- goes through the service role, a sign-in guard sits in front of every write made with a session client, the browser client only does auth, and the SECURITY DEFINER functions anon can call run as their owner,
-- so they do not need anon to hold a table privilege. Row level security is today the only thing between a signed-out caller and those writes: the audit of 8 Oct 2026 (read-only, preview and production)
-- found 14 write policies that name anon or PUBLIC and none of them without an identity check, so the grants are not reachable, but a policy written wrongly later would make them so. This revokes
-- INSERT, UPDATE and DELETE from anon (and from PUBLIC, which holds none) on every ordinary and partitioned table in public. A table-level revoke also clears the column-level grants of the same privilege
-- (job_postings carries 24 of them for anon). It also removes the three from the default privileges of the postgres role in schema public, so a table added by a later migration is created without them.
-- For supabase_admin (platform-created tables, not ours) the change is attempted and, if the migrating role may not change that role's defaults, reported and skipped, as in 0239.
--
-- NOT CHANGED. SELECT for anon (public reads: jobs, scholarships, blog), every privilege of authenticated and service_role, row level security, policies, functions, views, sequences. The block counts
-- anon's SELECT and every privilege of authenticated and service_role before and after and fails the migration if one number differs.
--
-- ORDER. Applies before or after any code change (it only removes a capability nothing uses). Independent of 0227 in effect; the standing test for it reads public.table_privilege_snapshot(), which 0227 creates,
-- so the test lands after 0227. The rollback gives the three back to anon on every table and in the postgres defaults (the Supabase default; the exact prior state is in the audit raw output).

do $m$
declare
  t record;
  d record;
  v_privs constant text[] := array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'];
  v_before_anon_select bigint;
  v_after_anon_select bigint;
  v_before_other bigint;
  v_after_other bigint;
  v_left text;
begin
  -- What must not change: anon's SELECT, and every privilege of authenticated and service_role, counted over every table in public (has_table_privilege also counts PUBLIC grants and inheritance).
  select count(*) into v_before_anon_select
    from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_catalog.has_table_privilege('anon', c.oid, 'select');
  select count(*) into v_before_other
    from pg_catalog.pg_class c
    cross join unnest(array['authenticated', 'service_role']) r
    cross join unnest(v_privs) p
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_catalog.has_table_privilege(r, c.oid, p);

  for t in
    select pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname) as tbl
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
     order by c.relname
  loop
    execute pg_catalog.format('revoke insert, update, delete on table %s from public, anon', t.tbl);
  end loop;

  -- New tables: the migrating role's own defaults first (strict), then any other grantor that has defaults in public (attempted).
  alter default privileges in schema public revoke insert, update, delete on tables from anon;
  for d in
    select distinct pg_catalog.pg_get_userbyid(a.defaclrole) as grantor
      from pg_catalog.pg_default_acl a
     where a.defaclnamespace = 'public'::regnamespace and a.defaclobjtype = 'r' and pg_catalog.pg_get_userbyid(a.defaclrole) <> current_user
  loop
    begin
      execute pg_catalog.format('alter default privileges for role %I in schema public revoke insert, update, delete on tables from anon', d.grantor);
    exception when insufficient_privilege then
      raise notice '0229: the default privileges of role % were not changed (the migrating role may not change them)', d.grantor;
    end;
  end loop;

  -- Self-check 1: anon holds none of the three on any table in public, directly, through PUBLIC or by inheritance; no column-level INSERT or UPDATE for anon remains; PUBLIC itself holds none.
  select string_agg(s.what, ', ' order by s.what) into v_left from (
    select c.relname::text || ': ' || p as what
      from pg_catalog.pg_class c
      cross join unnest(array['insert', 'update', 'delete']) p
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_catalog.has_table_privilege('anon', c.oid, p)
    union all
    select c.relname::text || '.' || a.attname::text || ': ' || g.privilege_type
      from pg_catalog.pg_class c
      join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null
      cross join lateral pg_catalog.aclexplode(a.attacl) g
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and g.privilege_type in ('INSERT', 'UPDATE')
       and g.grantee in (0, (select oid from pg_catalog.pg_roles where rolname = 'anon'))
    union all
    select c.relname::text || ': PUBLIC ' || g.privilege_type
      from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(c.relacl) g
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and g.grantee = 0 and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')) s;
  if v_left is not null then raise exception '0229 self-check: anon (or PUBLIC) still holds a write privilege: %', left(v_left, 600); end if;

  -- Self-check 2: the migrating role's defaults no longer give anon any of the three.
  if exists (
    select 1 from pg_catalog.pg_default_acl x cross join lateral pg_catalog.aclexplode(x.defaclacl) a
     where x.defaclnamespace = 'public'::regnamespace and x.defaclobjtype = 'r' and pg_catalog.pg_get_userbyid(x.defaclrole) = current_user
       and a.grantee = (select oid from pg_catalog.pg_roles where rolname = 'anon') and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then raise exception '0229 self-check: the default privileges of % still give anon a write privilege', current_user; end if;

  -- Self-check 3: nothing else changed.
  select count(*) into v_after_anon_select
    from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_catalog.has_table_privilege('anon', c.oid, 'select');
  select count(*) into v_after_other
    from pg_catalog.pg_class c
    cross join unnest(array['authenticated', 'service_role']) r
    cross join unnest(v_privs) p
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_catalog.has_table_privilege(r, c.oid, p);
  if v_after_anon_select <> v_before_anon_select then raise exception '0229 self-check: anon''s SELECT changed (% before, % after)', v_before_anon_select, v_after_anon_select; end if;
  if v_after_other <> v_before_other then raise exception '0229 self-check: a privilege of authenticated or service_role changed (% before, % after)', v_before_other, v_after_other; end if;
end
$m$;
