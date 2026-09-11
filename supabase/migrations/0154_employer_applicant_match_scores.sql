-- 0154 — surface each applicant's match score on the employer side.
-- Re-checked list_migrations on both projects immediately before writing
-- this (per this repo's own standing numbering discipline): 0153 was each
-- project's highest applied migration, 0154 was free on both.
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────
--
-- computeMatchScore (src/lib/matching/score.ts) is a pure function of
-- (resume, jobSkills, jobSeniority) — nothing about it is one-directional.
-- The seeker side already runs it for every job in a feed
-- (computeAndStoreMatchScores, src/lib/matching/compute-and-store.ts) and
-- caches the result in match_scores, keyed on (user_id, job_posting_id).
-- Today an employer's only triage tool is ApplicantStatusSelect — a fully
-- manual New/Reviewing/Shortlisted/Interviewing/Hired/Not a Fit dropdown,
-- set one applicant at a time by a human reading each one — with no ranking
-- anywhere. Running the SAME function, reading the SAME cache, the other
-- way is a low-lift extension of something already built and trusted, not
-- new scoring logic: this migration adds no computation, only a read.
--
-- ── WHY match_scores, NOT A NEW TABLE ────────────────────────────────────
--
-- An applicant's score against the job they applied to is exactly the row
-- match_scores already keys on: (user_id, job_posting_id). A second table
-- would just be a second place for the same fact to drift out of sync with
-- the first the moment a resume changes. The one real gap is that
-- match_scores is only ever written when the seeker views a job through a
-- scored surface (the feed or its detail page) — never guaranteed to exist
-- by the time they apply. The accompanying application-code change
-- (computeAndStoreApplicationMatchScore, src/lib/matching/compute-and-store.ts,
-- called from applyInAppAction) closes that gap going forward by writing the
-- cache at application time too, the one guaranteed moment a resume and a
-- job posting exist together. Applications that predate this migration may
-- still read a null score below — deliberately left that way rather than
-- backfilled, since a null is an honest "not yet scored" the UI can render
-- as such, not a wrong number.
--
-- ── WHY A LEFT JOIN, NOT A NEW FUNCTION ARGUMENT OR A REQUIRED SCORE ─────
--
-- Every applicant already listed by employer_job_applicants must keep
-- appearing whether or not a score exists — this is assistive ranking, not
-- a filter, per this feature's own scope. A LEFT JOIN against match_scores
-- on (user_id, job_posting_id) is the entire change: no new RLS surface
-- (match_scores itself is never granted to `authenticated` for this read —
-- this function is already SECURITY DEFINER and already the one door an
-- employer has onto applicant-identity-bearing data, per 0125's own header),
-- and no new argument for a caller to pass, since job_posting_id is already
-- this function's own parameter and applications.user_id is already
-- selected internally.
-- Postgres refuses CREATE OR REPLACE when OUT-parameter row shape changes
-- (42P13) — this function's return type is genuinely widening (five new
-- columns), so the drop is required, not a style choice.
drop function if exists public.employer_job_applicants(uuid);

create function public.employer_job_applicants(p_job_posting_id uuid)
returns table (
  application_id uuid,
  first_name text,
  last_name text,
  applied_at timestamp with time zone,
  resume_id uuid,
  status public.applicant_review_status,
  match_score integer,
  match_tier text,
  matched_skills jsonb,
  missing_skills jsonb,
  seniority_alignment text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    p.first_name,
    p.last_name,
    a.applied_at,
    a.resume_id,
    coalesce(s.status, 'new'::public.applicant_review_status),
    m.score,
    m.tier,
    m.explanation -> 'matchedSkills',
    m.explanation -> 'missingSkills',
    m.explanation ->> 'seniorityAlignment'
  from public.applications a
  join public.job_postings j on j.id = a.job_posting_id
  join public.profiles p on p.id = a.user_id
  left join public.employer_applicant_status s on s.application_id = a.id
  left join public.match_scores m on m.user_id = a.user_id and m.job_posting_id = a.job_posting_id
  where a.job_posting_id = p_job_posting_id
    -- The gate. Without this, any signed-in user could list applicants for
    -- any job posting by guessing its id.
    and public.is_org_member(j.organization_id)
    -- Actually applied, not merely saved/bookmarked — same predicate 0059
    -- uses, for the same reason: applied_at survives a later stage change,
    -- so this can never drop someone who applied and then archived the card
    -- in their own tracker, and never counts a bookmark as an applicant.
    and a.applied_at is not null
  -- Sorted by score by default (per this feature's own scope), highest
  -- first, with an unscored applicant (null) sorted LAST rather than first
  -- or interleaved — "we haven't measured this one yet" is not the same
  -- claim as "this one scored zero", and should not visually outrank an
  -- applicant who did. applied_at desc remains the tiebreak within a score
  -- (or within the unscored group), preserving this function's original
  -- ordering for anyone who never sees a score at all.
  order by m.score desc nulls last, a.applied_at desc;
$$;

revoke all on function public.employer_job_applicants(uuid) from public;
revoke all on function public.employer_job_applicants(uuid) from anon;
grant execute on function public.employer_job_applicants(uuid) to authenticated, service_role;

comment on function public.employer_job_applicants(uuid) is
  'Per-applicant rows for ONE job posting, scoped to the caller''s own organisation, sorted by match score (highest first, unscored last). Never returns email, applications.notes, or applications.stage (seeker-private, 0037) — only name, applied_at, resume_id, the employer''s own status (default new), and the SAME match score/explanation the seeker-side feed already computes and caches (match_scores) — read-only here, computed and written only by computeMatchScore''s existing callers.';
