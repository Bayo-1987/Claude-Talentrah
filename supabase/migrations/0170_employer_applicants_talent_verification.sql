-- 0170 — surface Talent Directory verification on the employer applicant
-- list (send-328). Cheap cross-pollination: a read of an existing,
-- already-computed fact (profiles.talent_verification_status/_score,
-- 0135) into an existing, already-SECURITY-DEFINER-gated view — no new
-- scoring, no new AI call, no change to how verification itself is
-- computed or reviewed.
--
-- ── THE CONSENT QUESTION, SETTLED ─────────────────────────────────────────
--
-- talent_verification_status and talent_directory_opt_in are separate,
-- independent columns (0135): a candidate can pay credits to verify their
-- skills without ever opting into the public, searchable directory. Showing
-- a "Verified" badge on every job they apply to, regardless of opt-in,
-- could surface information the candidate didn't consent to this employer
-- seeing — the same shape of question 0125 answered explicitly for resume
-- visibility.
--
-- Decided: the badge does NOT gate on talent_directory_opt_in. A verified
-- skill credential is closer to a resume fact (a certification) than to
-- "listed in a searchable directory" — the candidate has already
-- affirmatively applied to this specific job and this specific employer,
-- a stronger, narrower consent signal than being discoverable by any
-- employer browsing the directory at large. Gating on opt-in would hide a
-- real, true, employer-relevant signal from the one context where the
-- candidate has clearly already chosen to be seen by this employer.
--
-- ── WHY A LEFT JOIN, NOT A NEW RLS SURFACE ────────────────────────────────
--
-- Same reasoning 0154's own header gives for its match-score join: this
-- function is already SECURITY DEFINER with its own independent
-- is_org_member() check, so reading two more profiles columns through the
-- join it already has needs no new grant and no new policy.
--
-- Postgres refuses CREATE OR REPLACE when the OUT-parameter row shape
-- changes (42P13) — two new columns is a genuine widen, so the drop is
-- required, not a style choice (same as every prior widen of this
-- function).
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
  seniority_alignment text,
  talent_verification_status text,
  talent_verification_score integer
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
    m.explanation ->> 'seniorityAlignment',
    p.talent_verification_status,
    p.talent_verification_score
  from public.applications a
  join public.job_postings j on j.id = a.job_posting_id
  join public.profiles p on p.id = a.user_id
  left join public.employer_applicant_status s on s.application_id = a.id
  left join public.match_scores m on m.user_id = a.user_id and m.job_posting_id = a.job_posting_id
  where a.job_posting_id = p_job_posting_id
    -- The gate. Without this, any signed-in user could list applicants for
    -- any job posting by guessing its id.
    and public.is_org_member(j.organization_id)
    -- Actually applied, not merely saved/bookmarked.
    and a.applied_at is not null
  order by m.score desc nulls last, a.applied_at desc;
$$;

revoke all on function public.employer_job_applicants(uuid) from public;
revoke all on function public.employer_job_applicants(uuid) from anon;
grant execute on function public.employer_job_applicants(uuid) to authenticated, service_role;

comment on function public.employer_job_applicants(uuid) is
  'Per-applicant rows for ONE job posting, scoped to the caller''s own organisation, sorted by match score (highest first, unscored last). Never returns email, applications.notes, or applications.stage (seeker-private, 0037) — only name, applied_at, resume_id, the employer''s own status (default new), the seeker-side match score/explanation (match_scores, read-only here), and Talent Directory verification status/score (profiles, read-only here, NOT gated on talent_directory_opt_in — see this migration''s own header for why).';
