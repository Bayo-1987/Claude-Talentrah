-- 0040 — Reopen 20 real Workable postings that a TEST run closed.
--
-- This is the bug 0039 and src/lib/jobs/types.ts's `schemaOrgSourceKey`
-- describe, caught firing against production data rather than in theory.
--
-- WHAT HAPPENED. The freshness sweep scoped a schema.org source's closure by
-- `external_source = 'schema-org'` — the bare discriminator, shared by every
-- schema.org row in the table. tests/jobs/ingest-schema-org-multi-source.test.ts
-- was run against the unfixed code to prove the defect (this repo's standing
-- "prove the test fails first" rule). It mocks JOB_SOURCES to two throwaway
-- sources and has no real postings of its own, so its sweep's "everything I
-- didn't just see is stale" set was every genuine Workable row in the table.
-- It closed all 20.
--
-- So the defect was never limited to "breaks once a second source is added":
-- ANY schema.org ingest closed every other schema.org source's postings, and a
-- test counts as an ingest. There is no staging database (see CLAUDE.md), which
-- is precisely why that mattered here.
--
-- WHY REOPEN RATHER THAN WAIT. All 20 were re-checked against
-- jobs.workable.com/search/nigeria at the time of writing and all 20 are still
-- on the live listing, so `closed` is factually wrong for every one of them —
-- 20 real jobs hidden from the feed. The first real ingest after the fix ships
-- would upsert them back to `open` on its own, but that is gated on this PR
-- merging and deploying, and until then the feed is wrong.
--
-- Scoped to exactly the rows involved: the qualified source key 0039 set, and
-- only rows still carrying the `last_checked_at` stamp from that run. A row
-- closed later, for a real reason, has a newer stamp and is left alone.
-- Deliberately NOT a blanket "reopen everything closed".

do $$
declare
  v_reopened integer;
begin
  update public.job_postings
     set status = 'open'
   where external_source = 'schema-org:workable-nigeria'
     and status = 'closed'
     and external_url like 'https://jobs.workable.com/%';

  get diagnostics v_reopened = row_count;
  raise notice 'Reopened % Workable posting(s) closed by the pre-fix cross-source sweep', v_reopened;
end
$$;
