-- RENUMBERED 0137 -> 0142 for the same reason 0141's own header states (a
-- sibling dispatch claimed 0136/0137 independently) — pure filename rename,
-- applied to both live projects under the OLD name
-- (`0137_talent_directory_human_review`); see 0061's header for the same
-- situation and why the filename disagreeing with schema_migrations forever
-- is expected and survivable.
--
-- 0142 — Talent Directory human-reviewed verification ("Talent Directory v2,
-- part 2" — build-prompt §6.13's own "AI-graded + paid human review tier",
-- deliberately cut from 0135/send-139 because Mentorship's mentor network
-- did not exist yet. It now does (send-137, 0132/0133) — this is the first
-- feature to actually connect those two v1 slices rather than leave them as
-- parallel silos.
--
-- ── DESIGN DECISION 1: REVIEWER ELIGIBILITY IS OPT-IN, NOT AUTOMATIC ───────
--
-- An approved mentor does NOT automatically become a verification reviewer.
-- `mentor_profiles.reviews_verifications` (below) is a second, independent
-- boolean a mentor must explicitly turn on — the exact same shape 0135's own
-- header already used for `talent_directory_opt_in` ("a second, independent
-- choice... public visibility is a bigger exposure change than anything
-- automatic") and 0133 used for the mentor application itself being a
-- deliberate opt-in rather than an automatic grant to anyone qualified.
-- Reasoning specific to THIS decision: mentoring (a live, scheduled,
-- synchronous 1:1 call the mentor has already agreed to show up for) and
-- reviewing (an asynchronous, written judgment call on a stranger's resume,
-- pulled from a pool at the reviewer's own pace) are genuinely different
-- work with different availability and judgment demands — a mentor who is
-- vetted and comfortable running a mock interview may have no interest in,
-- or time for, sitting in a review queue. The vetting BAR is the same
-- (`status = 'approved'` is still required, reusing 0133's existing
-- pipeline rather than inventing a second one, per this dispatch's own
-- design direction), but the WORK is opt-in on top of that, not implied by
-- it.
--
-- ── DESIGN DECISION 2: ASSIGNMENT IS A REVIEWER-PICKS-FROM-A-POOL, NOT A
--    HARD AUTO-ASSIGN ─────────────────────────────────────────────────────
--
-- `talent_verification_review_queue()` below lists UNCLAIMED human-review
-- submissions to any eligible reviewer, soft-ranked (not hard-filtered) by
-- whether the candidate's stated target_role/target_industry overlaps the
-- reviewer's own `expertise_roles`/`expertise_industries` — reusing exactly
-- the columns this dispatch's own brief points at, without inventing a new
-- taxonomy. `claim_talent_verification_review()` is the atomic pick step.
-- Chosen over a hard auto-assignment for two concrete reasons:
--   1. Reviewers are volunteers/part-time (same pool as mentors, same
--      irregular-availability profile §6.11 already designed around). A hard
--      auto-assign creates an ORPHANED CLAIM the instant the assigned
--      reviewer doesn't act — which needs an expiry/reassignment sweep this
--      slice has no mandate to build (mentorship's OWN no-show handling
--      needed a whole cron sweep, mentorship-sweep.ts, to solve the
--      equivalent problem for scheduled sessions). A pool-pull has no such
--      failure mode: an unclaimed item just sits in the pool, visible to
--      every eligible reviewer, until someone takes it.
--   2. `expertise_roles`/`expertise_industries` are free text (0133's own
--      choice, matching this codebase's existing "text[], not a new enum"
--      taxonomy convention), so a HARD filter risks starving the queue for
--      any target_role that doesn't lexically match an available reviewer's
--      tags — a soft ranking degrades gracefully to "show the whole pool,
--      best matches first" instead.
--   3. The exact same atomic "conditional UPDATE ... WHERE" claim idiom
--      already proven twice in this repo (`auto_apply_claim_submission`
--      0034, `book_mentor_session`'s own slot lock 0133) covers this without
--      a new concurrency primitive — see `claim_talent_verification_review`
--      below.
--
-- ── DESIGN DECISION 3: REVIEWER PAYMENT IS RECORDED, NOT DISBURSED ─────────
--
-- Exactly 0133's own precedent for mentor payouts ("Talentrah collects the
-- full payment; the mentor's 85% share is recorded per session so a human
-- can run that payout manually, off-platform, for v1 — not disbursed by
-- code"). `reviewer_payout_ngn`, `reviewer_paid_at`, `reviewer_payout_reference`
-- on talent_verifications mirror that shape exactly: an integer NGN amount
-- computed once at resolution (never recomputed, same "computed once, at
-- booking, and never recomputed later" discipline 0133's own header states
-- for mentorship_sessions), a nullable "paid at" timestamp an operator sets
-- by hand for now (there is no admin UI for this in v1, matching 0133's own
-- level of investment — mentor payouts have no on-platform "mark paid" UI
-- either, only the column), and a free-text reference column generic enough
-- that a future automated payout system (send-153, NOT yet landed as of this
-- migration — confirmed via `git log --all` for any payout/Paystack-Transfer
-- PR before writing this) can populate it with a real transfer reference
-- without a schema rewrite, whichever shape that automation ends up taking.
-- If send-153 HAS landed by the time this is read and its own payout table
-- is a better fit, plug into that instead — nothing here is a competing
-- payout primitive, it is the same "record what's owed" placeholder 0133
-- already established, extended to a second kind of paid-to-a-mentor work.
--
-- ── WHY "CLAIMED" IS A NEW talent_verifications.status VALUE ───────────────
--
-- The AI path's `status = 'pending'` is transient (an LLM call in the same
-- request) but the human path's `pending` can sit in the queue indefinitely
-- — a bare boolean "claimed" flag would still need to answer "claimed by
-- whom, and is this row otherwise indistinguishable from AI's pending?", so
-- a real status value is more honest than overloading the existing one.
-- `resolve_talent_verification` (0135) is EXTENDED, not replaced, to
-- understand both `pending` (AI) and `claimed` (human, checked against the
-- claiming reviewer) as valid pre-resolution states — see below.

-- ── mentor_profiles: the opt-in toggle ──────────────────────────────────────

alter table public.mentor_profiles
  add column reviews_verifications boolean not null default false;

comment on column public.mentor_profiles.reviews_verifications is
  'Second, independent opt-in on top of status=approved (0142''s own header explains why reviewing is not automatic for every approved mentor). Mentor-writable — this is a work-preference flag, not a trust column.';

-- Additive column grant — Postgres column privileges accumulate per GRANT,
-- so this does not need to repeat 0133''s existing safe-column list.
grant update (reviews_verifications) on public.mentor_profiles to authenticated;

-- ── talent_verifications: extend the audit trail for the human-review path ─

alter table public.talent_verifications
  add column review_type text not null default 'ai' check (review_type in ('ai', 'human')),
  add column target_role text,
  add column target_industry text,
  -- Deliberately NO ON DELETE action (defaults to NO ACTION) — same
  -- reasoning CLAUDE.md and 0133 already state for mentorship_sessions.mentor_id:
  -- a reviewer's decision history must not silently vanish if their mentor
  -- account is later deleted. Deleting a mentor_profiles row is therefore
  -- blocked while they have reviewed submissions on record, same as a mentor
  -- with session history today.
  add column reviewer_id uuid references public.mentor_profiles(user_id),
  add column claimed_at timestamptz,
  add column reviewer_notes text,
  add column reviewer_payout_ngn integer not null default 0 check (reviewer_payout_ngn >= 0),
  add column reviewer_paid_at timestamptz,
  add column reviewer_payout_reference text;

comment on column public.talent_verifications.review_type is
  '''ai'' (default, 0135''s original synchronous LLM-graded path) or ''human'' (0142). Set once at request time by which credit_reason the request spent — never changes afterwards.';
comment on column public.talent_verifications.target_role is
  'Optional, candidate-supplied free text (0142) — used only as a soft ranking hint in talent_verification_review_queue(), never a hard filter or a new taxonomy.';
comment on column public.talent_verifications.reviewer_id is
  'Set only by claim_talent_verification_review() below. Null means unclaimed (still in the pool) for a human-review row, or not applicable for an ai row.';
comment on column public.talent_verifications.reviewer_payout_ngn is
  '0 for ai-graded rows. For human-graded rows, set ONCE by resolve_talent_verification() at the moment of decision (never at claim time — a reviewer who claims but never decides is owed nothing) — see that function''s own header for why the formula is duplicated as a literal there rather than accepted as a caller-supplied parameter.';
comment on column public.talent_verifications.reviewer_paid_at is
  'Manually set by an operator once the off-platform payout actually happens (0142''s header — mirrors mentorship''s own no-automation-yet stance for mentor_payout_ngn). Null = not yet paid.';

-- The AI path''s transient ''pending'' now shares meaning with the human
-- path''s ''pending'' (queued, unclaimed) and gains a new ''claimed'' state in
-- between ''pending'' and the resolved states — see this migration''s own
-- header for why a real status value is more honest than a bolted-on flag.
alter table public.talent_verifications drop constraint talent_verifications_status_check;
alter table public.talent_verifications
  add constraint talent_verifications_status_check
  check (status in ('pending', 'claimed', 'verified', 'rejected'));

-- No RLS policy change on talent_verifications. The existing owner-only
-- SELECT policy (0135) stays exactly as-is — deliberately NOT widened to let
-- a reviewer see rows they don''t own, for the same reason 0135''s own header
-- gives for the directory search path: widening a row policy here would
-- widen it for every other query that inherits it, not just the reviewer
-- queue. Every reviewer-facing read below is a narrow SECURITY DEFINER
-- function with its own independent WHERE clause instead, proven directly in
-- tests/rls/talent-directory-review.test.ts.

-- ── claim_talent_verification_review: the one atomic pick step ────────────
--
-- service_role only, exactly like book_mentor_session (0133) and
-- runTalentVerification''s own claim step (0135) — p_reviewer_id is a trusted
-- parameter the calling Server Action already resolved via requireUser()''s
-- own session lookup, not something this function re-derives from auth.uid()
-- (a service-role call has no session context to read one from anyway).
--
-- Re-derives reviewer eligibility (approved AND reviews_verifications)
-- itself rather than trusting the caller''s own prior read of it — the same
-- "don''t trust a client-supplied entitlement claim" discipline
-- book_mentor_session already applies to mentor_status.
create or replace function public.claim_talent_verification_review(
  p_reviewer_id uuid,
  p_verification_id uuid
)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_reviews_verifications boolean;
  v_locked_id uuid;
begin
  select mp.status, mp.reviews_verifications into v_status, v_reviews_verifications
  from public.mentor_profiles mp
  where mp.user_id = p_reviewer_id;

  if v_status is distinct from 'approved' or coalesce(v_reviews_verifications, false) = false then
    return query select false, 'NOT_ELIGIBLE_REVIEWER'::text; return;
  end if;

  update public.talent_verifications
     set status = 'claimed', reviewer_id = p_reviewer_id, claimed_at = now()
   where id = p_verification_id
     and review_type = 'human'
     and status = 'pending'
     and reviewer_id is null
     and user_id <> p_reviewer_id
  returning id into v_locked_id;

  if v_locked_id is null then
    -- Distinguish "you tried to review your own submission" from "someone
    -- else already claimed it / it doesn''t exist" so the UI can say
    -- something accurate — mirrors book_mentor_session''s own
    -- SLOT_UNAVAILABLE vs CANNOT_BOOK_OWN_LISTING split (0133).
    if exists (
      select 1 from public.talent_verifications
      where id = p_verification_id and user_id = p_reviewer_id
    ) then
      return query select false, 'CANNOT_REVIEW_OWN_SUBMISSION'::text; return;
    end if;
    return query select false, 'ALREADY_CLAIMED'::text; return;
  end if;

  return query select true, 'ok'::text;
end;
$$;

revoke all on function public.claim_talent_verification_review(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_talent_verification_review(uuid, uuid) to service_role;

-- ── release_talent_verification_review_claim: return an item to the pool ──
--
-- Distinct from release_talent_verification_claim (0135), which cancels a
-- candidate''s own not-yet-claimed request outright (deletes the row). This
-- is the reviewer''s own "I picked this up, but I''m releasing it back to the
-- pool without deciding" step — a genuinely different operation, so it gets
-- a different name rather than overloading the existing one's meaning.
create or replace function public.release_talent_verification_review_claim(
  p_reviewer_id uuid,
  p_verification_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated uuid;
begin
  update public.talent_verifications
     set status = 'pending', reviewer_id = null, claimed_at = null
   where id = p_verification_id
     and reviewer_id = p_reviewer_id
     and status = 'claimed'
  returning id into v_updated;

  return v_updated is not null;
end;
$$;

revoke all on function public.release_talent_verification_review_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_talent_verification_review_claim(uuid, uuid) to service_role;

-- ── resolve_talent_verification: EXTENDED, not replaced ────────────────────
--
-- CORRECTED BY 0144 — read that migration first. This header originally
-- claimed CREATE OR REPLACE FUNCTION can add trailing defaulted parameters
-- to an existing function in place. That is false: Postgres identifies the
-- function to replace by name AND ARGUMENT TYPE LIST, so the statement below
-- created a SECOND, OVERLOADED function alongside the original 5-argument
-- one rather than replacing it, which broke verification-runner.ts''s
-- existing 5-named-argument AI-path call (ambiguous between the two
-- overloads). Caught by tests/talent-directory/reviewer-payout.test.ts,
-- fixed by 0144 dropping the stale 5-arg overload so only this 7-arg
-- function remains. The two new trailing parameters (p_reviewer_id,
-- p_reviewer_notes) both default to null, so once 0144 has run,
-- verification-runner.ts''s unmodified call still resolves correctly via
-- those defaults — just through one function, not the two this statement
-- actually produced on its own.
--
-- THE REVIEWER PAYOUT FORMULA IS A LITERAL HERE, ON PURPOSE, NOT A
-- CALLER-SUPPLIED PARAMETER — same reasoning book_mentor_session (0133) already
-- states for why session pricing is computed INSIDE the atomic SQL statement
-- rather than trusted from the calling Server Action: this is a service-role
-- function, and accepting a payout amount as a parameter would mean a bug
-- (not even malice) in the calling code could write an arbitrary figure. The
-- human-review credit cost is flat (unlike mentorship''s per-session-type
-- pricing), so the formula is simple: 60 credits (CREDIT_COSTS.talentDirectoryHumanReview,
-- src/lib/credits/costs.ts) * ₦125/credit (the established rate, same
-- costs.ts header) * 85% payout share (mirrors 0133''s own 15% platform
-- commission exactly, i.e. the same human-labor split already approved in
-- this codebase) = ₦6,375. MUST be kept in sync with those TS constants by
-- hand if either changes — tests/talent-directory/reviewer-payout.test.ts is
-- the cross-check that actually proves the two haven''t drifted, the same
-- role tests/mentorship/commission-split.test.ts already plays for 0133''s
-- own duplicated formula.
create or replace function public.resolve_talent_verification(
  p_verification_id uuid,
  p_user_id uuid,
  p_verified boolean,
  p_score integer,
  p_feedback text,
  p_reviewer_id uuid default null,
  p_reviewer_notes text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_status text := case when p_verified then 'verified' else 'rejected' end;
  v_reviewer_payout_ngn integer := round(60 * 125 * 0.85);
  v_updated uuid;
begin
  update public.talent_verifications
     set status = v_new_status,
         ai_score = p_score,
         ai_feedback = p_feedback,
         decided_at = now(),
         reviewer_notes = coalesce(p_reviewer_notes, reviewer_notes),
         reviewer_payout_ngn = case when p_reviewer_id is not null then v_reviewer_payout_ngn else reviewer_payout_ngn end
   where id = p_verification_id
     and user_id = p_user_id
     and (
       (p_reviewer_id is null and status = 'pending')
       or (p_reviewer_id is not null and status = 'claimed' and reviewer_id = p_reviewer_id)
     )
  returning id into v_updated;

  if v_updated is null then
    return false;
  end if;

  update public.profiles
     set talent_verification_status = v_new_status,
         talent_verification_score = p_score,
         talent_verified_at = case when p_verified then now() else null end
   where id = p_user_id;

  return true;
end;
$$;

revoke all on function public.resolve_talent_verification(uuid, uuid, boolean, integer, text, uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_talent_verification(uuid, uuid, boolean, integer, text, uuid, text) to service_role;

-- ── talent_verification_review_queue / _detail / _my_claims ────────────────
--
-- All three SECURITY DEFINER, all three re-derive the caller's own identity
-- and entitlement from auth.uid() (never a client-supplied reviewer id) —
-- the same discipline talent_directory_search/_portfolio_items (0135) and
-- employer_job_applicants/employer_view_resume (0125) already established
-- for exactly this shape of "read across other users' data" problem. Every
-- WHERE clause is independent (no shared view) so none can be reached by
-- forgetting another one's guard.
create or replace function public.talent_verification_review_queue(p_limit integer default 20)
returns table (
  id uuid,
  requested_at timestamptz,
  target_role text,
  target_industry text,
  expertise_match boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_roles text[];
  v_industries text[];
begin
  select mp.expertise_roles, mp.expertise_industries into v_roles, v_industries
  from public.mentor_profiles mp
  where mp.user_id = auth.uid() and mp.status = 'approved' and mp.reviews_verifications = true;

  -- Not an eligible reviewer at all (no matching row) leaves v_roles NULL —
  -- distinct from an eligible reviewer with no expertise tags set, whose
  -- default is the NOT NULL '{}' from mentor_profiles (0133), so this
  -- correctly tells "not eligible" apart from "eligible, empty tags".
  if v_roles is null then
    return;
  end if;

  return query
    select tv.id, tv.requested_at, tv.target_role, tv.target_industry,
           (
             (tv.target_role is not null and exists (
               select 1 from unnest(v_roles) r
               where tv.target_role ilike '%' || r || '%' or r ilike '%' || tv.target_role || '%'
             ))
             or
             (tv.target_industry is not null and exists (
               select 1 from unnest(v_industries) i
               where tv.target_industry ilike '%' || i || '%' or i ilike '%' || tv.target_industry || '%'
             ))
           ) as expertise_match
    from public.talent_verifications tv
    where tv.review_type = 'human'
      and tv.status = 'pending'
      and tv.user_id <> auth.uid()
    order by expertise_match desc, tv.requested_at asc
    limit least(coalesce(p_limit, 20), 50);
end;
$$;

revoke all on function public.talent_verification_review_queue(integer) from public, anon;
grant execute on function public.talent_verification_review_queue(integer) to authenticated;

comment on function public.talent_verification_review_queue(integer) is
  'The reviewer-picks-from-a-pool listing (0142''s own header, design decision 2). expertise_match is a SOFT ranking hint from free-text overlap, never a hard filter — an eligible reviewer always sees the full unclaimed pool, best matches first. Deliberately omits candidate name/resume (privacy minimisation pre-claim) — see talent_verification_review_detail for what a reviewer sees AFTER claiming.';

-- What the reviewer actually sees once they''ve claimed an item: the SAME
-- submission material the AI grader consumes (verification-runner.ts's own
-- resume read, structured_content of the candidate's base resume) plus
-- enough identity to review meaningfully. Gated on reviewer_id = auth.uid()
-- AND status = 'claimed' — a stale/guessed id that the caller doesn't
-- currently hold the claim on returns zero rows, same as a plain lookup that
-- matches nothing.
create or replace function public.talent_verification_review_detail(p_verification_id uuid)
returns table (
  id uuid,
  status text,
  target_role text,
  target_industry text,
  requested_at timestamptz,
  candidate_first_name text,
  candidate_last_name text,
  resume jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return query
    select tv.id, tv.status, tv.target_role, tv.target_industry, tv.requested_at,
           p.first_name, p.last_name,
           coalesce(r.structured_content, '{}'::jsonb)
    from public.talent_verifications tv
    join public.profiles p on p.id = tv.user_id
    left join public.resumes r on r.user_id = tv.user_id and r.is_base = true
    where tv.id = p_verification_id
      and tv.reviewer_id = auth.uid()
      and tv.status = 'claimed';
end;
$$;

revoke all on function public.talent_verification_review_detail(uuid) from public, anon;
grant execute on function public.talent_verification_review_detail(uuid) to authenticated;

-- A reviewer's own "continue reviewing" list — claimed, not yet decided.
create or replace function public.talent_verification_my_claims()
returns table (
  id uuid,
  requested_at timestamptz,
  claimed_at timestamptz,
  target_role text,
  target_industry text
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return query
    select tv.id, tv.requested_at, tv.claimed_at, tv.target_role, tv.target_industry
    from public.talent_verifications tv
    where tv.reviewer_id = auth.uid() and tv.status = 'claimed'
    order by tv.claimed_at asc;
end;
$$;

revoke all on function public.talent_verification_my_claims() from public, anon;
grant execute on function public.talent_verification_my_claims() to authenticated;
