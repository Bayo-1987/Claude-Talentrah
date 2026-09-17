-- 0172 — surface `applications.screening_passed` (0171) on the employer
-- applicant list. Third widen of employer_job_applicants in this batch
-- (0170 added Talent Directory verification) — same drop+recreate pattern
-- every prior widen used, restating every column from 0170's shape plus
-- this one new column.
--
-- No new RLS surface: `applications.screening_passed` is already readable
-- by this function's own security-definer body, same as every other
-- applications/profiles/match_scores column it already selects.
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
  talent_verification_score integer,
  screening_passed boolean
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
    p.talent_verification_score,
    a.screening_passed
  from public.applications a
  join public.job_postings j on j.id = a.job_posting_id
  join public.profiles p on p.id = a.user_id
  left join public.employer_applicant_status s on s.application_id = a.id
  left join public.match_scores m on m.user_id = a.user_id and m.job_posting_id = a.job_posting_id
  where a.job_posting_id = p_job_posting_id
    and public.is_org_member(j.organization_id)
    and a.applied_at is not null
  order by m.score desc nulls last, a.applied_at desc;
$$;

revoke all on function public.employer_job_applicants(uuid) from public;
revoke all on function public.employer_job_applicants(uuid) from anon;
grant execute on function public.employer_job_applicants(uuid) to authenticated, service_role;

comment on function public.employer_job_applicants(uuid) is
  'Per-applicant rows for ONE job posting, scoped to the caller''s own organisation, sorted by match score (highest first, unscored last). Never returns email, applications.notes, or applications.stage (seeker-private, 0037) — only name, applied_at, resume_id, the employer''s own status (default new), the seeker-side match score/explanation (match_scores, read-only here), Talent Directory verification status/score (profiles, read-only here, NOT gated on talent_directory_opt_in), and screening_passed (applications, 0171 — null means no screening questions or answers incomplete, never gates whether the application itself was accepted).';
