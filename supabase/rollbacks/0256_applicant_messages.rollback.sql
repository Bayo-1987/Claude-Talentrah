-- ROLLBACK for 0256 (applicant_messages, claim_applicant_message, organization_premium, admin_set_organization_premium). Not a migration: it is the exact undo, kept beside the file it undoes so it is reviewed in the same diff.
-- Run it as `postgres` in the SQL Editor (one transaction). To keep what the schema ledger says honest, record it as a NEW migration (do not delete 0256's ledger row). `supabase/rollbacks/` is outside
-- supabase/migrations, so neither the migration-numbering check nor `supabase db push` ever sees it.
--
-- WHAT IT CHANGES: the message log (and every row in it), the blanking trigger on applications and its function, the two other functions and the Premium table (and every date in it) are dropped; audit rows already written stay in admin_audit_log. Nothing else.
-- NOT UNDONE: the enum value 'farah_message_draft_charge' on ad_wallet_reason stays (Postgres cannot drop an enum value); it is unused once the code is gone and harmless.
-- ORDER: deploy the code that sends messages and reads Premium away first (or the page that sends would fail); the 20-per-day limit and the record of what was sent are gone with the table.
begin;

drop trigger if exists applications_blank_applicant_messages on public.applications;
drop function if exists public.blank_applicant_messages_on_application_delete();
drop function if exists public.admin_set_organization_premium(uuid, timestamptz, uuid, text, uuid, text);
drop function if exists public.claim_applicant_message(uuid, uuid, uuid, uuid, text, text, text, integer);
drop table if exists public.organization_premium;
drop table if exists public.applicant_messages;

commit;
