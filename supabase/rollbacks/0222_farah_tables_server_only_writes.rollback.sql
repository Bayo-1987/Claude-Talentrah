-- ROLLBACK for 0222 (message history is written by the server only). Not a migration: the exact undo, kept beside the file it undoes, outside supabase/migrations so nothing that reads migrations
-- ever applies it. Run it as `postgres` in the SQL Editor. To keep the schema ledger honest, record it as a NEW migration (do not delete 0222's ledger row).
--
-- WHAT IT DOES: puts INSERT and DELETE on public.farah_messages back for the signed-in role (authenticated), which is what the project's default privileges had given it. It does NOT restore anything
-- for the anonymous role (0222's dry run prints the before-state, so what anon held is on record), and it does not touch farah_session_events (its write privileges were already revoked by 0151, so 0222 changed
-- nothing there). Only run it if the route change that saves history with the service role has itself been reverted.

begin;

grant insert, delete on table public.farah_messages to authenticated;

do $check$
begin
  if not (pg_catalog.has_table_privilege('authenticated', 'public.farah_messages'::regclass, 'insert')
      and pg_catalog.has_table_privilege('authenticated', 'public.farah_messages'::regclass, 'delete')) then
    raise exception '0222 rollback: authenticated did not get INSERT and DELETE back on public.farah_messages';
  end if;
end
$check$;

commit;
