-- Rollback of 0274 (PR-E1, apply by email): removes job_postings.apply_email. Dropping the column also drops its length check and its column grants.
-- Idempotent: it runs cleanly where 0274 was never applied and can be run twice. Run it only after the code that selects the column is off (the job page and the feed name the column in their select list, so
-- they fail with "column does not exist" until the deploy that removes it lands); any address stored in the column is lost.
set local lock_timeout = '3s';

alter table public.job_postings drop column if exists apply_email;
