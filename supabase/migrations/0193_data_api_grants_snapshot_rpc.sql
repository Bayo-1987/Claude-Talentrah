-- send-459 — enables tests/rls/data-api-grants.test.ts (0192's own standing
-- regression test) to actually run against a real project.
--
-- PostgREST does not expose `information_schema` to a supabase-js client at
-- all — confirmed twice already in this repo, independently, for the
-- identical reason: tests/employer/assessment-storage-rls.test.ts's own
-- "EXPLICIT GRANT CHECK" comment ("PostgREST does not expose
-- information_schema/pg_proc to the JS client"), and 0096's header, which
-- hit the same wall trying to reach `supabase_migrations.schema_migrations`
-- and settled on exactly this answer: a SECURITY DEFINER function in
-- `public` (a schema PostgREST DOES expose), doing the introspection query
-- itself inside Postgres and returning plain rows a normal .rpc() call can
-- read.
--
-- This also turned out to fix a second, unrelated problem found while
-- building it: a direct information_schema.role_table_grants query run
-- against PRODUCTION through the Supabase MCP connector's own execute_sql
-- came back completely EMPTY for grants independently confirmed to exist
-- via pg_class.relacl — information_schema.role_table_grants only shows
-- rows visible to the CALLING role's own membership, and that connection's
-- role apparently isn't a member of the granting role for these tables. A
-- SECURITY DEFINER function's "current user" during execution is the
-- function's OWNER, not the caller — confirmed empirically before shipping
-- this, not assumed: a throwaway probe function scoped to job_posting_reports
-- correctly returned its `authenticated: INSERT` grant against production,
-- where the bare query had returned nothing.
--
-- Scoped to service_role only, unlike 0096 (which had to be reachable by an
-- unauthenticated CI script and gates itself behind a custom JWT claim as a
-- result) — this is called only from the test harness's own real
-- service-role key, so there's no reason to expose it to anon/authenticated
-- at all. Returns every anon/authenticated grant on every public table, not
-- just the eight this send cares about, so it's a standing tool for the next
-- grant audit too, not a one-off scoped to 0192.
create or replace function public.data_api_grants_snapshot()
returns table (table_name text, grantee text, privilege_type text)
language sql
stable
security definer
set search_path = public
as $$
  select g.table_name, g.grantee, g.privilege_type
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.grantee in ('anon', 'authenticated');
$$;

revoke all on function public.data_api_grants_snapshot() from public, anon, authenticated;
grant execute on function public.data_api_grants_snapshot() to service_role;

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'data_api_grants_snapshot'
  ) then
    raise exception 'data_api_grants_snapshot did not get created';
  end if;
end $$;
