-- 0055 — the `removed` job status, alone.
--
-- Split from 0056 purely for Postgres's benefit: a new enum value cannot be
-- USED in the same transaction that adds it (55P04, "unsafe use of new value"),
-- and 0056's policies compare against 'removed' literally. Two files is the
-- cheapest way to say that; there is nothing else in this one.

alter type public.job_status add value if not exists 'removed';
