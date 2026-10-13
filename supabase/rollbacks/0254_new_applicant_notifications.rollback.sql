-- ROLLBACK for 0254 (new-applicant notifications). Not a migration: the exact undo, kept beside the file it undoes so it is reviewed in the same diff.
-- Run it as `postgres` in ONE transaction (it is written to be). To keep what the schema ledger says honest, record it as a NEW migration (do not delete 0254's ledger row).
-- WHAT IT CHANGES: the two triggers on applications, the six functions, the notifications table (with every row in it) and the column email_preferences.new_applicant_notice (with each person's choice) are dropped. Nothing else changes: no application row is touched.
-- Notifications not yet emailed are LOST by this, so the hashed wrapper refuses while any unsent row exists. ORDER: deploy away the code that sends and claims first, or stop the digest route, or it would call functions that no longer exist.
begin;

drop trigger if exists applications_new_applicant_on_insert on public.applications;
drop trigger if exists applications_new_applicant_on_stage on public.applications;
drop function if exists public.new_applicant_recipients(uuid);
drop function if exists public.release_applicant_digest(uuid[]);
drop function if exists public.claim_applicant_digest(timestamptz, integer);
drop function if exists public.release_applicant_instant(uuid);
drop function if exists public.claim_applicant_instant(uuid);
drop function if exists public.record_new_applicant_notification();
drop table if exists public.employer_applicant_notifications;
alter table public.email_preferences drop column if exists new_applicant_notice;

commit;
