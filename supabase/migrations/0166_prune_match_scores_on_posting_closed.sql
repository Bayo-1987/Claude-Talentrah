-- 0166 — drop a job's cached match scores once it closes.
--
-- ── THE DEFECT (issue #149) ───────────────────────────────────────────────
--
-- `match_scores` is a cache of "how well does this user's resume fit this
-- posting" (0069's own words), and nothing removes a row when the posting
-- it was computed against closes. A feed visit doesn't do it either — the
-- feed only ever scores postings it fetched, and it fetches
-- `status = 'open'`, so a row whose posting has since closed is simply never
-- revisited again.
--
-- Measured on production directly: 49 stale rows of 950 total (5.2%) across
-- four accounts, growing with posting churn rather than with users — every
-- ingest cycle that closes a posting leaves one orphan per user who had been
-- scored against it.
--
-- ── WHY THIS IS HYGIENE, NOT A BEHAVIOUR CHANGE ───────────────────────────
--
-- Checked directly against the current `auto_apply_claim_submission`
-- (0034, last touched by 0164) before writing this: it re-reads
-- `job_postings.status` live and rejects with `job_closed` BEFORE it ever
-- reads `match_scores` —
--
--   select (j.status = 'open') into v_job_open
--     from public.job_postings j where j.id = v_row.job_posting_id;
--   if v_job_open is distinct from true then
--     update public.auto_apply_queue q set status = 'expired', ...
--     return query select false, 'job_closed'::text, ...
--
-- — so a stale `match_scores` row for a closed posting was already
-- unreachable from Auto-Apply's live path regardless of this migration. The
-- job feed (`.eq("status", "open")`) and `promoted_jobs()` (scoped to open
-- inside the function, 0052/0109) are the only other two readers, and both
-- already scope to open postings the same way. This migration prunes rows
-- that no live feature could ever have used — data hygiene, not a defect fix.
--
-- ── WHY A TRIGGER, AND A SIBLING RATHER THAN EXTENDING 0069's ─────────────
--
-- Same reasoning 0069 gave for JD/seniority changes: an app-layer rule is
-- only as good as the number of writers that remember it, and ingestion is
-- not the only thing that can flip `status` to 'closed' (moderation,
-- expiry jobs, future admin tooling all can). A trigger cannot be routed
-- around.
--
-- A SIBLING trigger/function rather than widening
-- `invalidate_match_scores_on_jd_change`'s own WHEN clause: that function's
-- name and comment ("scoring inputs changed") describe a different class of
-- event than "the posting stopped being matchable at all" — a closed
-- posting's `structured_jd` and `seniority` haven't changed, so folding this
-- in would either need a second, oddly-named function anyway or make one
-- function's purpose harder to state precisely. Two small single-purpose
-- triggers on the same table is exactly what 0069 already does one of.
--
-- `after update of status`, not a bare `after update`, for the same reason
-- 0069 scoped to `of structured_jd, seniority` — so this only re-checks rows
-- on the one column transition it cares about, not on every update to the
-- table.
create or replace function public.match_scores_prune_on_posting_closed()
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

comment on function public.match_scores_prune_on_posting_closed() is
  'Clears cached match_scores for a posting that has closed and can no longer be matched. See 0166 / issue #149.';

drop trigger if exists match_scores_prune_on_posting_closed on public.job_postings;

create trigger match_scores_prune_on_posting_closed
  after update on public.job_postings
  for each row
  when (
    old.status is distinct from new.status
    and new.status = 'closed'
  )
  execute function public.match_scores_prune_on_posting_closed();

-- ── ONE-TIME BACKFILL ──────────────────────────────────────────────────────
--
-- Deletes every existing match_scores row whose posting is already closed —
-- the 49-ish rows (as of two weeks ago; posting churn means the real count
-- at apply time will likely be higher) the trigger above would never have
-- caught because they predate it. `returning job_posting_id` so the apply
-- run reports the real, measured count rather than an estimate.
delete from public.match_scores ms
  using public.job_postings j
  where ms.job_posting_id = j.id
    and j.status = 'closed'
returning ms.job_posting_id;
