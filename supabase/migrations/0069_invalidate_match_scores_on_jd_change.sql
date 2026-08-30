-- 0069 — drop a job's cached match scores when its requirements change.
--
-- ── THE DEFECT ────────────────────────────────────────────────────────────
--
-- `match_scores` is a cache of "how well does this user's resume fit this
-- posting", and nothing invalidated it when the posting changed. Aggregation
-- re-ingests postings continuously and upserts `structured_jd` in place, so a
-- score computed against one set of requirements silently survived them being
-- replaced.
--
-- Measured on production, all 642 rows: SIX carry an explanation naming skills
-- the posting no longer lists. Small, and growing with every re-ingest — and
-- the rows are not merely cosmetic. `scanAndQueue` reads a user's scores at or
-- above the Auto-Apply threshold directly from this table (limit 200), NOT
-- only the ones the feed just recomputed. A stale row is therefore a route to
-- queueing an application against requirements that no longer exist.
--
-- That became materially worse in the same week: before the scoring fix that
-- preceded this migration, no user had ever scored in the Excellent band, so
-- the Auto-Apply reader had nothing to act on. Now it does.
--
-- ── WHY A TRIGGER AND NOT A CHECK IN THE INGEST CODE ──────────────────────
--
-- The same reasoning 0037 used for `hired` being terminal: an app-layer rule
-- is only as good as the number of writers that remember it. Ingestion is not
-- the only thing that can write `structured_jd` — the moderation surfaces and
-- any future backfill or admin correction can too, and each would have to
-- remember to clear the cache. A trigger cannot be routed around.
--
-- ── WHY DELETE AND NOT RECOMPUTE ──────────────────────────────────────────
--
-- Recomputing needs each affected user's resume, which is application work and
-- cannot happen inside a statement trigger. Deleting is the honest primitive:
-- these rows are a CACHE, `computeAndStoreMatchScores` rewrites them on the
-- next feed load, and the failure mode of a missing row is that Auto-Apply
-- does not see that job until then. That fails closed, which is the correct
-- direction for something that can submit an application in a user's name.
--
-- ── WHY NOT AN AGE-BASED SWEEP ────────────────────────────────────────────
--
-- Measured rather than argued, against the same 642 rows:
--
--   this trigger        flips exactly the 6 genuinely stale rows,  0 false
--   expire after 24h    flips 334 rows to catch those 6          328 false
--   expire after 7d     flips 1 row, catching essentially none      0 false
--
-- A 24-hour sweep is a 55:1 false-positive ratio — it would discard half the
-- cache on a schedule to find six rows. A 7-day sweep is quiet and useless:
-- scores are recomputed on every feed visit, so almost nothing survives long
-- enough for age to correlate with staleness. Age is simply not the signal;
-- "the posting changed" is, and that is knowable exactly.
--
-- A content hash column compared at read time would be equally precise and was
-- not chosen because it needs a new column on two tables and a check at every
-- read site, to answer a question the database can answer at write time.
--
-- ── SCOPE ─────────────────────────────────────────────────────────────────
--
-- ONLY `structured_jd`. A posting's title, salary or description changing does
-- not alter what the score was computed from — `computeMatchScore` reads the
-- skills array and the seniority and nothing else. `seniority` is included for
-- that reason; it is the second input.
--
-- `is distinct from` rather than `<>` so a NULL on either side is handled: a
-- posting that gains or loses its structured_jd entirely is a change.

create or replace function public.invalidate_match_scores_on_jd_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.match_scores where job_posting_id = new.id;
  return new;
end;
$$;

comment on function public.invalidate_match_scores_on_jd_change() is
  'Clears cached match_scores for a posting whose scoring inputs changed. See 0069.';

drop trigger if exists match_scores_invalidate_on_jd_change on public.job_postings;

create trigger match_scores_invalidate_on_jd_change
  after update on public.job_postings
  for each row
  when (
    old.structured_jd is distinct from new.structured_jd
    or old.seniority is distinct from new.seniority
  )
  execute function public.invalidate_match_scores_on_jd_change();

-- NO BACKFILL HERE, deliberately.
--
-- The obvious one — delete rows whose stored explanation disagrees with the
-- posting's current skills — is exactly how the six were found, and it stops
-- being a valid test the moment the scoring change that precedes this lands:
-- from then on an explanation legitimately OMITS the non-screenable terms, so
-- every correct new row would look stale by that comparison and be deleted.
--
-- It is also unnecessary. Every row that exists when this ships was computed
-- by the previous scorer and is superseded regardless; the full recompute run
-- alongside this migration rewrites all of them. This trigger's job is the
-- rows created after that, and there is nothing yet for it to catch up on.
