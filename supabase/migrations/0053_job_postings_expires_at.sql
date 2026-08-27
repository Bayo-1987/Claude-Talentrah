-- 0053 — job_postings.expires_at. Schema only.
--
-- A column for the date a posting stops being valid, and nothing that reads
-- it: no default, no backfill, no cron, no UI, and no close-on-expiry rule.
-- That is the whole change, deliberately.
--
-- WHY NULLABLE WITH NO DEFAULT. A default would be a guess about every one of
-- the 150 rows already here, and a backfill would write that guess down as if
-- a source had said it. NULL means "no source told us when this ends", which
-- is the truth for every existing posting and for most future ones — of the
-- external boards we ingest, only some schema.org listings carry
-- `validThrough` at all. A nullable column keeps "unknown" distinguishable
-- from "known and far away"; a default collapses the two permanently, and no
-- later migration can tell them apart again.
--
-- WHY NOTHING CONSUMES IT YET. Closing a posting is the ingest pipeline's job
-- and it already has an opinion: a posting is open while the source keeps
-- serving it, and `last_checked_at` is the evidence (see 0000's freshness
-- sweep and src/lib/jobs/ingest.ts). Adding a second, independent authority
-- that can close the same row is a design decision with a real failure mode —
-- an expiry date the employer forgot to extend silently removing a job the
-- board is still advertising — and it should be decided on its own, not
-- smuggled in with the column that enables it.
--
-- Consequence worth stating plainly: until something reads it, this column
-- affects nothing. A row with `expires_at` in the past stays `open` and stays
-- in the feed. That is expected, not a bug to be found later.

alter table public.job_postings
  add column expires_at timestamptz;

comment on column public.job_postings.expires_at is
  'When the posting stops being valid, per its source. NULL means unknown — no source stated one. Nothing reads this yet: it does not close a posting and does not filter the feed.';
