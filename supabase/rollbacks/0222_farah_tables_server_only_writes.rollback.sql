-- ROLLBACK for 0222 (message history is written by the server only). Not a migration: kept beside the file it undoes, outside supabase/migrations so nothing that reads migrations ever applies it.
-- PROVISIONAL: built from the LOCAL TEST HARNESS's ACLs, not from production. Before 0222 is applied it is REPLACED by the file built from the production dry run's BEFORE output (build-rollback.py), and reviewed against it.
-- Run it as `postgres` in the SQL Editor. To keep the schema ledger honest, record it as a NEW migration (do not delete 0222's ledger row). Only run it if the route change that saves history with the service role has itself been reverted.
-- BEFORE farah_messages: {postgres=arwdDxtm/postgres,anon=ardDxtm/postgres,authenticated=ardDxtm/postgres,service_role=arwdDxtm/postgres}
-- BEFORE farah_session_events: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=rDxtm/postgres,service_role=arwdDxtm/postgres}

begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

grant insert, delete, truncate, references, trigger on table public.farah_messages to anon;
grant insert, delete, truncate, references, trigger on table public.farah_messages to authenticated;
grant insert, update, delete, truncate, references, trigger on table public.farah_session_events to anon;
grant truncate, references, trigger on table public.farah_session_events to authenticated;

-- Checks itself: for anon, authenticated and PUBLIC, the six privileges on both tables must be EXACTLY the set the before-state held.
do $check$
declare
  v_expected constant text := 'farah_messages:anon:delete farah_messages:anon:insert farah_messages:anon:references farah_messages:anon:trigger farah_messages:anon:truncate farah_messages:authenticated:delete farah_messages:authenticated:insert farah_messages:authenticated:references farah_messages:authenticated:trigger farah_messages:authenticated:truncate farah_session_events:anon:delete farah_session_events:anon:insert farah_session_events:anon:references farah_session_events:anon:trigger farah_session_events:anon:truncate farah_session_events:anon:update farah_session_events:authenticated:references farah_session_events:authenticated:trigger farah_session_events:authenticated:truncate';
  v_actual   text;
begin
  select coalesce(string_agg(x, ' ' order by x), '') into v_actual from (
    select c.relname::text || ':' || case when a.grantee = 0 then 'public' else pg_catalog.pg_get_userbyid(a.grantee) end || ':' || lower(a.privilege_type) as x
      from pg_catalog.pg_class c, pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
     where c.oid in ('public.farah_messages'::regclass, 'public.farah_session_events'::regclass)
       and lower(a.privilege_type) in ('insert', 'update', 'delete', 'truncate', 'references', 'trigger')
       and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
  ) s;
  if v_actual <> v_expected then
    raise exception '0222 rollback: privileges are [%] but the before-state was [%]', v_actual, v_expected;
  end if;
end
$check$;

commit;
