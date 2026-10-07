-- 0239: anon and authenticated no longer hold TRUNCATE, REFERENCES or TRIGGER on any table in schema public, and new tables are no longer created with them.
--
-- WHAT. Supabase hands every new table in public to the two client roles with all seven table privileges. Three of them are not privileges the application can use: TRUNCATE (the statement of that name; nothing in
-- the application, the scripts, the tests or any migration sends it, and the Data API cannot), TRIGGER (only needed to CREATE a trigger; an existing trigger fires without the caller holding it) and REFERENCES
-- (only needed to CREATE a foreign key; enforcement of an existing foreign key, ON DELETE CASCADE included, runs as the table owner, which 0222 already documents). Row level security does not apply to TRUNCATE,
-- so a client role that ever reached SQL could empty a table it holds the privilege on. This revokes the three from anon, authenticated and PUBLIC on every ordinary and partitioned table in public.
-- Audit of the preview and the production project before this was written (7 Oct 2026, identical result, same tables in the same groups): 78 tables; 46 gave all three to both roles, 7 gave all three to
-- authenticated only (ad_wallet_ledger, country_default_events, payment_transactions, resume_builder_start_events, talent_directory_subscriptions, talent_verifications, user_passes), 25 gave none; no grant to
-- PUBLIC; no view; no public function contains a TRUNCATE statement, CREATE TRIGGER or foreign-key DDL (162 read on preview, 161 on production), so no function run as a client role could be using them.
--
-- ALSO FOR FUTURE TABLES. pg_default_acl gives every table created by the migrating role (postgres) in public, and by supabase_admin, TRUNCATE, REFERENCES and TRIGGER for the two client roles. The same three
-- are revoked from those defaults for postgres, so a table added by a later migration does not bring them back. For supabase_admin (platform-created tables, not ours) the change is attempted and, if the
-- migrating role is not allowed to change that role's defaults, reported and skipped. It changes no existing object: only what a table created from now on receives.
--
-- WHAT IT DOES NOT TOUCH. SELECT, INSERT, UPDATE, DELETE (table or column level) for any role, every privilege of service_role and postgres, row level security, policies, functions, views, sequences.
-- The block counts those privileges for every table before and after and fails the migration if one number differs.
--
-- ORDER. Nothing in the application uses these privileges, so this applies before or after any code change (additive in effect: it only removes unused capability). The rollback restores the recorded
-- before-state exactly (supabase/rollbacks/0239_client_ddl_privileges_revoke.rollback.sql).

do $m$
declare
  t record;
  d record;
  v_roles constant text[] := array['anon', 'authenticated'];
  v_before_kept bigint;
  v_after_kept bigint;
  v_before_service bigint;
  v_after_service bigint;
  v_left text;
begin
  -- The privileges that must NOT change: select, insert, update, delete for the two client roles, and all seven for service_role, counted over every table in public.
  select count(*) into v_before_kept
    from pg_catalog.pg_class c
    cross join unnest(v_roles) r
    cross join unnest(array['select', 'insert', 'update', 'delete']) p
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_catalog.has_table_privilege(r, c.oid, p);
  select count(*) into v_before_service
    from pg_catalog.pg_class c
    cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_catalog.has_table_privilege('service_role', c.oid, p);

  for t in
    select pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname) as tbl
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
     order by c.relname
  loop
    execute pg_catalog.format('revoke truncate, references, trigger on table %s from public, anon, authenticated', t.tbl);
  end loop;

  -- New tables: the migrating role's own defaults first (strict), then any other grantor that has defaults in public (attempted).
  alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
  for d in
    select distinct pg_catalog.pg_get_userbyid(a.defaclrole) as grantor
      from pg_catalog.pg_default_acl a
     where a.defaclnamespace = 'public'::regnamespace and a.defaclobjtype = 'r' and pg_catalog.pg_get_userbyid(a.defaclrole) <> current_user
  loop
    begin
      execute pg_catalog.format('alter default privileges for role %I in schema public revoke truncate, references, trigger on tables from anon, authenticated', d.grantor);
    exception when insufficient_privilege then
      raise notice '0239: the default privileges of role % were not changed (the migrating role may not change them)', d.grantor;
    end;
  end loop;

  -- Self-check 1: no client role holds any of the three on any table in public, directly, through PUBLIC or by inheritance, and PUBLIC itself holds none.
  select string_agg(c.relname || ': ' || r || ' ' || p, ', ' order by c.relname, r, p) into v_left
    from pg_catalog.pg_class c
    cross join unnest(v_roles) r
    cross join unnest(array['truncate', 'references', 'trigger']) p
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_catalog.has_table_privilege(r, c.oid, p);
  if v_left is not null then raise exception '0239 self-check: a client role still holds a privilege: %', v_left; end if;
  if exists (
    select 1 from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(c.relacl) a
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and a.grantee = 0 and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) then raise exception '0239 self-check: PUBLIC itself still holds one of the three on a table in public'; end if;

  -- Self-check 2: the migrating role's defaults no longer give the three to the client roles.
  if exists (
    select 1 from pg_catalog.pg_default_acl x cross join lateral pg_catalog.aclexplode(x.defaclacl) a
     where x.defaclnamespace = 'public'::regnamespace and x.defaclobjtype = 'r' and pg_catalog.pg_get_userbyid(x.defaclrole) = current_user
       and a.grantee in (select oid from pg_catalog.pg_roles where rolname = any (v_roles)) and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) then raise exception '0239 self-check: the default privileges of % still give one of the three to a client role', current_user; end if;

  -- Self-check 3: nothing else changed.
  select count(*) into v_after_kept
    from pg_catalog.pg_class c
    cross join unnest(v_roles) r
    cross join unnest(array['select', 'insert', 'update', 'delete']) p
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_catalog.has_table_privilege(r, c.oid, p);
  select count(*) into v_after_service
    from pg_catalog.pg_class c
    cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_catalog.has_table_privilege('service_role', c.oid, p);
  if v_after_kept <> v_before_kept then raise exception '0239 self-check: select/insert/update/delete of the client roles changed (% before, % after)', v_before_kept, v_after_kept; end if;
  if v_after_service <> v_before_service then raise exception '0239 self-check: the privileges of service_role changed (% before, % after)', v_before_service, v_after_service; end if;
end
$m$;
