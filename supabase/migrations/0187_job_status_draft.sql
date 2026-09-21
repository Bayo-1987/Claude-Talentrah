-- 0187 — the `draft` job status, alone.
--
-- Split from 0188 for the same Postgres reason 0055/0056 split 'removed'
-- from its own policy work: a new enum value cannot be USED (compared
-- against a literal) in the same transaction that adds it (55P04, "unsafe
-- use of new value"), and 0188's policies compare against 'draft' literally.

alter type public.job_status add value if not exists 'draft';
