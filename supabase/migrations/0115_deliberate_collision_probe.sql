-- TEMPORARY PROBE, not for merge. Deliberately reuses 0115, which main already
-- has as 0115_job_posting_banners.sql, to prove the collision guard fails in
-- real CI rather than only in a local run. Its PR is closed immediately after.
select 1;
