-- Rollback of 0278 (JOBS-POLISH-1, P5): removes job_postings.expires_at_source, its guard trigger and the two functions. Dropping the column also drops its check and its column grants.
-- Idempotent: it runs cleanly where 0278 was never applied and can be run twice. Run it only after the code that selects or writes the column is off (the job page, the feed, the importer and ingest name it,
-- so they fail with "column does not exist" until the deploy that removes it lands); the stored values are lost, and the backfill rule would have to be re-run to recover them.
set local lock_timeout = '3s';

drop trigger if exists job_postings_guard_expires_at_source on public.job_postings;
drop function if exists public.job_postings_guard_expires_at_source();
drop function if exists public.expires_at_source_backfill(timestamptz, timestamptz);
alter table public.job_postings drop column if exists expires_at_source;
