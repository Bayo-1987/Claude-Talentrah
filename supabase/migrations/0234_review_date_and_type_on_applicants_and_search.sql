-- 0234 — say WHEN a resume was reviewed and BY WHOM, on the two employer-side reads.
--
-- VERIFY-1 step 0a-2. The employer screens now show "Resume reviewed by Farah (AI) · 5 Oct 2026" or "Resume reviewed by a mentor · …".
-- Step 0a-1 inferred the "by whom" half from the stored score in application code. This moves that inference to ONE place in the
-- database, so the two screens cannot disagree about it, and it adds the missing date to the applicant list.
--
--   employer_job_applicants(uuid)   + talent_verified_at (the review date) + talent_review_type
--   talent_directory_search(...)    + review_type          (it already returned verified_at, the date)
--
-- review_type is DERIVED, not stored. Nothing is added to profiles and nothing is backfilled:
--   * a review by Farah (the automated grader) always writes a number: the grader clamps its score to 0..100 and falls back to 0, so it
--     never stores null;
--   * a review by a mentor never writes a number: reviewer-runner.ts passes p_score = null to resolve_talent_verification;
--   * resolve_talent_verification writes status 'verified' only when the review passed, and it is the only writer of these columns.
-- So for a verified profile "score is null" means a mentor and "score is a number" means Farah. For a profile that is not verified there is
-- no review to describe, so the type is null.
--
-- NOT changed, deliberately:
--   * Who is listed. The paid search still reads its gate from talent_directory_listed_ids() and must not restate it (the standing check in
--     tests/talent-directory/gate-single-definition.test.ts fails if it does). That is why the search derives the type from the score alone:
--     anything the helper lists is already verified, and the helper is the only place that rule is written.
--   * The applicant list is still not gated on directory opt-in (0170): an employer sees the review status of someone who applied to them
--     whether or not that person is listed. It still hides people who asked to delete their account (0212).
--   * Grants. Both functions keep exactly the grants they have: authenticated and service_role, nothing for anon or public.
--
-- Changing a function's return columns cannot be done with CREATE OR REPLACE, so each is dropped and recreated in this one transaction
-- (the pattern 0170 and 0172 used). Neither function has a dependent object (no view, no other function calls it). The recreate keeps
-- `create or replace function public.<name>(` as its first words on purpose: the standing check reads the LAST migration that spells it
-- that way as the live definition, and a plain `create function` would leave it reading the old text.

drop function if exists public.employer_job_applicants(uuid);

create or replace function public.employer_job_applicants(p_job_posting_id uuid)
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
  screening_passed boolean,
  talent_verified_at timestamp with time zone,
  talent_review_type text
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
    a.screening_passed,
    case when p.talent_verification_status = 'verified' then p.talent_verified_at end,
    case
      when p.talent_verification_status = 'verified' and p.talent_verification_score is null then 'mentor'
      when p.talent_verification_status = 'verified' then 'ai'
    end
  from public.applications a
  join public.job_postings j on j.id = a.job_posting_id
  join public.profiles p on p.id = a.user_id
  left join public.employer_applicant_status s on s.application_id = a.id
  left join public.match_scores m on m.user_id = a.user_id and m.job_posting_id = a.job_posting_id
  where a.job_posting_id = p_job_posting_id
    and public.is_org_member(j.organization_id)
    and a.applied_at is not null
    and p.deletion_requested_at is null
  order by m.score desc nulls last, a.applied_at desc;
$$;

revoke all on function public.employer_job_applicants(uuid) from public;
revoke all on function public.employer_job_applicants(uuid) from anon;
grant execute on function public.employer_job_applicants(uuid) to authenticated, service_role;

comment on function public.employer_job_applicants(uuid) is
  'Per-applicant rows for ONE job posting, scoped to the caller''s own organisation, sorted by match score (highest first, unscored last). Never returns email, applications.notes, or applications.stage (seeker-private, 0037) — only name, applied_at, resume_id, the employer''s own status (default new), the seeker-side match score/explanation (match_scores, read-only here), Talent Directory resume review status/score (profiles, read-only here, NOT gated on talent_directory_opt_in), the review date and who reviewed (talent_verified_at and talent_review_type, 0234: ''ai'' = Farah, ''mentor'' = a mentor, null when the resume is not reviewed; the type is derived from the score being null, not stored), and screening_passed (applications, 0171 — null means no screening questions or answers incomplete, never gates whether the application itself was accepted). People who asked to delete their account are not listed (0212).';

drop function if exists public.talent_directory_search(boolean, boolean, integer, integer, uuid);

create or replace function public.talent_directory_search(
  p_remote_ready boolean default null,
  p_available_for_hire boolean default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_candidate_id uuid default null
)
returns table (
  user_id uuid,
  first_name text,
  last_name text,
  country text,
  available_for_hire boolean,
  remote_ready boolean,
  earliest_start_date date,
  verification_score integer,
  verified_at timestamp with time zone,
  review_type text
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
begin
  if not exists (
    select 1
    from public.organization_members om
    join public.talent_directory_subscriptions s on s.organization_id = om.organization_id
    where om.user_id = auth.uid()
      and s.status = 'active'
      and s.expires_at > now()
  ) then
    return;
  end if;

  return query
    select p.id, p.first_name, p.last_name, p.country,
           p.talent_available_for_hire, p.talent_remote_ready, p.talent_earliest_start_date,
           p.talent_verification_score, p.talent_verified_at,
           case when p.talent_verification_score is null then 'mentor' else 'ai' end
    from public.profiles p
    where p.id in (select l.id from public.talent_directory_listed_ids() as l(id))
      and (p_remote_ready is null or p.talent_remote_ready = p_remote_ready)
      and (p_available_for_hire is null or p.talent_available_for_hire = p_available_for_hire)
      and (p_candidate_id is null or p.id = p_candidate_id)
    order by (p.talent_boosted_until is not null and p.talent_boosted_until > now()) desc,
             p.talent_verified_at desc
    limit least(coalesce(p_limit, 20), 50)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.talent_directory_search(boolean, boolean, integer, integer, uuid) from public, anon;
grant execute on function public.talent_directory_search(boolean, boolean, integer, integer, uuid) to authenticated, service_role;
