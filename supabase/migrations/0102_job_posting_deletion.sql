-- 0102 — Stage 5b: job posting deletion, the FK groundwork.
--
-- Stage 5a (bae526d, PR #210) added a 30-day visibility floor and started
-- snapshotting {companyName, title, url, location} onto every `applications`
-- row at creation, specifically so that row could survive its job_posting_id
-- being deleted later. Stage 5b is "later": this migration is the schema half
-- of actually deleting closed postings, on top of which a deletion job reads.
--
-- ── THE FK TABLE, AS APPROVED — implemented exactly, not re-derived ────────
--
-- | table                    | column                  | before    | after      |
-- |---------------------------|------------------------|-----------|------------|
-- | match_scores              | job_posting_id          | CASCADE   | CASCADE (unchanged) |
-- | auto_apply_queue          | job_posting_id          | CASCADE   | CASCADE (unchanged) |
-- | applications              | job_posting_id          | NO ACTION | SET NULL   |
-- | ad_campaigns               | job_posting_id          | CASCADE   | CASCADE (unchanged) |
-- | ad_events                  | job_posting_id          | CASCADE   | CASCADE (unchanged) |
-- | job_posting_reports        | job_posting_id          | CASCADE   | CASCADE (unchanged) |
-- | job_tailoring_requests     | source_job_posting_id   | NO ACTION | SET NULL   |
-- | resumes                    | tailored_for_job_id     | NO ACTION | SET NULL   |
--
-- Reasoning (kept here, not just in the PR description, per this repo's own
-- convention that a migration carries its own "why"):
--
--   * match_scores is computed relevance, not history — fine to cascade away.
--   * auto_apply_queue rows that already submitted have already produced
--     their own permanent `applications` row, so cascading the queue row
--     loses nothing.
--   * ad_wallet_ledger only soft-references campaigns via `related_entity_id`
--     with no FK (checked directly, not assumed — grep across every
--     migration and every `ad_wallet_ledger` insert site turns up no
--     `campaign_id` column at all), so cascading a campaign never touches
--     financial history.
--   * job_tailoring_requests stores its own `source_jd_text` and
--     `gap_analysis`; `resumes` are stamped "Tailored — {job title}" at
--     creation (src/lib/resume-builder — the title is a plain string copied
--     once, not a live reference) — both are self-describing without the FK,
--     hence SET NULL rather than CASCADE: deleting the posting later must not
--     also delete a tailoring request's own record or a resume the user is
--     still using.
--   * applications is the one Stage 5a specifically built for: SET NULL
--     relies on `manual_job_snapshot` already being populated, which is the
--     backfill immediately below.
--
-- None of the three SET NULL columns needed a nullability change —
-- `applications.job_posting_id`, `job_tailoring_requests.source_job_posting_id`
-- and `resumes.tailored_for_job_id` have all been nullable uuid columns since
-- 0000_baseline_schema.sql, and no migration since has tightened any of them
-- (checked, not assumed: grepped every migration touching these three columns
-- before writing this).
--
-- ── THE BACKFILL THIS MIGRATION MUST DO FIRST, AND WHY ──────────────────────
--
-- `applications` carries `constraint applications_job_reference_check CHECK
-- ((job_posting_id IS NOT NULL) OR (manual_job_snapshot IS NOT NULL))`. Once
-- job_posting_id can go to NULL on delete, any application row that reaches
-- that moment with manual_job_snapshot ALSO null would fail this CHECK the
-- instant the FK tries to null it — which does not "orphan" the row, it
-- ABORTS THE WHOLE DELETE, because a CHECK violation raised mid-cascade rolls
-- back the statement that triggered it. A 30-day deletion job that could be
-- unpredictably vetoed by one old row is not a working deletion job.
--
-- This is not hypothetical. Checked directly against both live projects
-- before writing this migration, because "Stage 5a needed zero backfill (0 of
-- today's 93 stale postings have an application)" is a true but narrower
-- claim than "every application has a snapshot" — it was only ever about the
-- postings already past the freshness floor at that moment, not about every
-- application row that predates the three snapshot-writing call sites
-- (toggleSaveAction, applyInAppAction, markAppliedExternallyAction) Stage 5a
-- actually touched:
--
--   production (nytwbbzfpytctjsoczzq): 27 applications, 22 with a live
--     job_posting_id and NO manual_job_snapshot — every one of them a save,
--     apply or "mark applied externally" written before Stage 5a existed.
--   CI (dozaffzgqkbarxtlclsj): 9 applications, 6 in the same state.
--
-- Auto-Apply's own two applications writes (src/lib/auto-apply/actions.ts,
-- the "handed_off" and "submitted" upserts) were a SECOND gap Stage 5a never
-- touched at all — it only patched the three seeker-initiated actions, not
-- the auto_apply_claim_submission path. Left alone, every auto-apply
-- application created from today onward would keep recreating the exact row
-- this backfill is fixing. That code path is patched in the same PR as this
-- migration (src/lib/auto-apply/actions.ts now calls loadJobSnapshot too) —
-- a schema migration cannot fix an application-layer gap, but it can, and
-- must, stop pretending the gap only ever produced historical rows.
--
-- The backfill itself reads the STILL-LIVE job_postings row each affected
-- application points at (safe today precisely because the FK is still
-- NO ACTION until the ALTER below runs, so job_posting_id is guaranteed valid
-- for every non-null row) and writes the exact shape
-- src/lib/applications/job-snapshot.ts already produces.
update public.applications a
set manual_job_snapshot = jsonb_strip_nulls(jsonb_build_object(
  'companyName', j.company_name,
  'title', j.title,
  'location', j.location,
  'url', j.external_url
))
from public.job_postings j
where a.job_posting_id = j.id
  and a.manual_job_snapshot is null;

-- ── The three FK rule changes ───────────────────────────────────────────────

alter table public.applications
  drop constraint applications_job_posting_id_fkey,
  add constraint applications_job_posting_id_fkey
    foreign key (job_posting_id) references public.job_postings(id) on delete set null;

alter table public.job_tailoring_requests
  drop constraint job_tailoring_requests_source_job_posting_id_fkey,
  add constraint job_tailoring_requests_source_job_posting_id_fkey
    foreign key (source_job_posting_id) references public.job_postings(id) on delete set null;

alter table public.resumes
  drop constraint resumes_tailored_for_job_id_fkey,
  add constraint resumes_tailored_for_job_id_fkey
    foreign key (tailored_for_job_id) references public.job_postings(id) on delete set null;

-- ── `closed_at`: the timestamp the deletion job actually needs ─────────────
--
-- Not in the approved FK table, because it is not an FK change — it is the
-- piece the 30-day deletion job (src/lib/jobs/posting-deletion.ts, this same
-- PR) cannot work without and that nothing on this table already provides.
--
-- "Delete postings closed for 30+ days" needs a timestamp that means "when
-- did this become closed", and job_postings has no such column. The three
-- candidates that already exist all fail for a different reason each:
--
--   * `last_checked_at` is bumped by `ingestAllSources`' presence-driven
--     closure (src/lib/jobs/ingest.ts) at the moment it closes a row, but
--     `closeStaleExternalPostings` (src/lib/jobs/expiry.ts, the 72h backstop)
--     deliberately does NOT touch it when closing — checked directly against
--     both function bodies, not assumed from one of them. Two closure paths,
--     two different meanings for the same column, is not a signal a deletion
--     job can safely threshold on.
--   * For an INTERNAL posting, `last_checked_at` is set once at insert/edit
--     and never touched again (expiry.ts's own header, unchanged by this
--     migration) — it means "last edited by the employer", not "closed on".
--     An employer who posts with a 90-day expiry and never edits again would
--     have a `last_checked_at` already 90 days stale the moment
--     `closeExpiredInternalPostings` closes it, making it look 90 days closed
--     when it just closed. Using it as the deletion threshold would delete
--     some internal postings the instant they close.
--   * `expires_at` is a fact a SOURCE or an employer stated (validThrough /
--     the employer's chosen expiry date), not an observation this system
--     made — and most external closures (the 72h staleness backstop, the
--     presence-driven sweep) never populate it at all. Reusing it here would
--     be the same "invent a fact nobody stated" mistake expiry.ts's own
--     header already forbids for the opposite direction.
--
-- `removed_at` (0056) is the precedent this follows: a plain timestamp,
-- stamped at every place that sets `status`, cleared when the row leaves that
-- status. `closed_at` does the same for `closed`, and is stamped in this PR at
-- every one of the FIVE places `status` can become `'closed'` — found by
-- grepping every status write across the codebase, not by re-checking only
-- the two this feature happens to touch most often:
--
--   1. closeExpiredInternalPostings (src/lib/jobs/expiry.ts)
--   2. closeStaleExternalPostings (src/lib/jobs/expiry.ts)
--   3. ingestAllSources' presence-driven closure (src/lib/jobs/ingest.ts)
--   4. setJobStatusAction, the employer's own Close/Reopen toggle
--      (src/lib/employer/actions.ts) — also clears closed_at back to NULL on
--      Reopen, the same way 0079's restore branch clears removed_at
--   5. admin_moderate_job_posting's restore branch (0079, replaced below) —
--      restoring a removed posting lands it back on 'closed', per the admin
--      UI's own "Restore to closed" label, so that transition needs the
--      timestamp too
--
-- add column, no default: a bare `default now()` would stamp EVERY existing
-- row (including every currently-open one) with today's timestamp at ALTER
-- time, which is wrong for a column that must stay NULL for anything not
-- closed. The scoped backfill below is the deliberate replacement.
alter table public.job_postings
  add column closed_at timestamptz;

comment on column public.job_postings.closed_at is
  'When this posting''s status last became closed. NULL for anything not currently closed. Cleared on reopen/restore, same convention as removed_at (0056). The 30-day deletion job (posting-deletion.ts) thresholds on this, not on last_checked_at or expires_at — see this migration''s own header for why neither of those means what a deletion job needs it to mean.';

-- Backfill for rows already closed before this column existed. Their REAL
-- closure time is not recoverable — last_checked_at means something
-- different depending which of the three pre-existing closure paths touched
-- each row (see above), so guessing from it would silently misdate some rows
-- while looking precise for all of them. Stamping `now()` instead is the
-- conservative, honest choice: it does not claim to know a historical fact it
-- doesn't have, and it means the 30-day clock for every pre-existing closed
-- posting starts from the day this migration runs, not earlier — a posting
-- that has genuinely been closed for 90 days waits the same 30 days as one
-- closed yesterday, which only delays deletion, never hastens it.
update public.job_postings
set closed_at = now()
where status = 'closed' and closed_at is null;

-- ── admin_moderate_job_posting's restore branch also needs the stamp ───────
--
-- `create or replace function` on an existing function, the same pattern
-- 0088 already used to change 0034's function body — this is not a new
-- function, it is 0079's with one field added to the one branch that lands a
-- row on 'closed'. The 'remove' branch, the permission check, the reason
-- validation and the return shape are all byte-for-byte what 0079 shipped.
create or replace function public.admin_moderate_job_posting(
  p_actor uuid,
  p_id uuid,
  p_action text,
  p_reason text
)
returns table (ok boolean, reason text, new_status text)
language plpgsql
security definer
set search_path = public
as $$
declare v_status text;
begin
  if not public.admin_has_permission(p_actor, 'reported_postings') then
    return query select false, 'not_authorised'::text, null::text; return;
  end if;
  if p_action not in ('remove', 'restore') then
    return query select false, 'bad_action'::text, null::text; return;
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    return query select false, 'reason_required'::text, null::text; return;
  end if;

  if p_action = 'remove' then
    update public.job_postings
       set status = 'removed', removed_at = now(),
           removal_reason = btrim(p_reason), removed_by = p_actor
     where id = p_id and status <> 'removed'
    returning status into v_status;
  else
    update public.job_postings
       set status = 'closed',
           removed_at = null, removal_reason = null,
           removed_by = p_actor,
           -- New in 0102: restoring a removed posting lands it on 'closed'
           -- (the admin UI's own "Restore to closed" label), which is a
           -- closing event the 30-day deletion job needs to know about the
           -- same as any other. Unconditional `now()`, matching the removal
           -- branch's own unconditional `now()` above — a restored posting's
           -- prior closed_at (if any, from before it was reported) describes
           -- a closure this operator decision has superseded.
           closed_at = now()
     where id = p_id and status = 'removed'
    returning status into v_status;
  end if;

  if v_status is null then
    return query select false, 'wrong_state'::text, null::text; return;
  end if;
  return query select true, 'ok'::text, v_status;
end;
$$;
