-- Rollback of 0279 (JOBS-LIFECYCLE-1, stage 1): removes exactly what 0279 added: the two functions, the two tables and the two feature_flags rows.
-- Idempotent: it runs cleanly where 0279 was never applied and can be run twice.
-- Run it only when no code calls the functions (the nightly delete, from stage 1 part 2, calls job_posting_delete_unreferenced; deploy the code that stops first, or the nightly delete deletes nothing
-- and logs the error, which is the safe failure). DROPPING THE TOMBSTONE TABLE LOSES THE TOMBSTONES: a row_snapshot is the only copy of a deleted job, so do not run this after a delete wave you may want to undo.
set local lock_timeout = '3s';

drop function if exists public.job_posting_reference_report();
drop function if exists public.job_posting_delete_unreferenced(uuid[], timestamptz, uuid);
drop table if exists public.job_posting_tombstones;
drop table if exists public.job_posting_lifecycle_runs;
delete from public.feature_flags where key in ('job_lifecycle_close_imports', 'job_lifecycle_delete_unreferenced');
