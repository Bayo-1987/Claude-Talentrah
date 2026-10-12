-- ROLLBACK for 0253 (schedule interview). Not a migration: the exact undo, kept beside the file it undoes so it is reviewed in the same diff.
-- Run it as `postgres` in ONE transaction (it is written to be). To keep what the schema ledger says honest, record it as a NEW migration (do not delete 0253's ledger row).
-- WHAT IT CHANGES: the two triggers (one on employer_applicant_status, one on profiles.deletion_requested_at), the fourteen functions and the three tables are dropped, with every offer, slot and booking in them. NOTHING ELSE changes: no existing table was altered. Booked interviews are LOST by this, so the hashed wrapper refuses while any booking exists.
-- ORDER: deploy the code that offers and books away first, or the pages would call functions that no longer exist.
begin;

drop trigger if exists interview_cancel_on_applicant_status on public.employer_applicant_status;
drop trigger if exists interview_close_on_deletion_request on public.profiles;
drop function if exists public.release_interview_reminder(uuid);
drop function if exists public.claim_interview_reminders(timestamptz, timestamptz, integer);
drop function if exists public.expire_interview_offers();
drop function if exists public.interview_close_on_deletion_request();
drop function if exists public.cancel_interviews_for_deleting_applicant(uuid);
drop function if exists public.release_interview_cancellation_email(uuid);
drop function if exists public.claim_interview_cancellation_emails(integer);
drop function if exists public.cancel_stale_interview_bookings();
drop function if exists public.interview_cancel_on_applicant_status();
drop function if exists public.cancel_interview_for_application(uuid, text);
drop function if exists public.interview_overlaps(uuid, uuid, jsonb);
drop function if exists public.book_interview_slot(uuid, uuid);
drop function if exists public.create_interview_offer(uuid, uuid, text, text, jsonb);
drop function if exists public.interview_offer_state(uuid);
drop table if exists public.interview_bookings;
drop table if exists public.interview_slots;
drop table if exists public.interview_offers;

commit;
