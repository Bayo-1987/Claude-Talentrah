-- 0234 — say WHEN a resume was reviewed and BY WHOM, on the two employer-side reads, and tell an employer NOTHING ELSE about the review.
--
-- VERIFY-1 step 0a-2. The employer screens now show "Resume reviewed by Farah (AI) · 5 Oct 2026" or "Resume reviewed by a mentor · …".
-- Step 0a-1 inferred the "by whom" half from the stored score in application code. This replaces that inference with the value the database already
-- records, read in ONE place for both screens, and adds the missing date to the applicant list.
--
--   employer_job_applicants(uuid)   + talent_verified_at (the review date) + talent_review_type
--                                   - talent_verification_score (gone)
--                                   ~ talent_verification_status: now 'verified' or null, never 'pending', 'rejected' or 'unverified'
--   talent_directory_search(...)    + review_type          (it already returned verified_at, the date)
--                                   - verification_score (gone)
--                                   ~ search_path '' (was 'public'), and its COMMENT
--
-- WHY THE SCORE AND THE STATUS GO. Both functions are callable with an employer's own login, whatever the page shows. Until now an employer calling
-- employer_job_applicants directly could read every applicant's review score (a rejected applicant's included) and their 'rejected' or 'pending' status, and
-- talent_directory_search returned the score of every listed candidate. VERIFY-1 0a says an employer sees no score; the status of a review that did not pass
-- is the candidate's own business. So the score is not returned by either function, and the applicant list's status is 'verified' for a review that passed and
-- null for everything else (a pending, rejected or never-requested review looks the same to an employer: nothing). The candidate still sees their own score
-- and status on their own page, which reads their own profile row and not these functions.
--
-- The type is READ, not inferred: talent_verifications.review_type ('ai' or 'human', 0142) is set once, when a review is requested, by which credit the
-- request spent, and never changes. Both employer reads return the review_type of the candidate's LATEST PASSED review (status 'verified', newest decided_at;
-- the review that made the profile verified, since resolve_talent_verification is the only writer of 'verified' and it writes both rows together).
-- A reviewer of type 'human' is always a mentor (talent_verifications.reviewer_id references mentor_profiles). If a verified profile has no passed review row
-- (the type cannot be established), the type is null and the screens say "Resume reviewed" with no reviewer; nothing is guessed.
-- Nothing is added to any table, nothing is backfilled, and no index is added (the table holds one row per review request).
--
-- NOT changed, deliberately:
--   * Who is listed. The paid search still reads its gate from talent_directory_listed_ids() and must not restate it (the standing check in
--     tests/talent-directory/gate-single-definition.test.ts fails if it does). The search reads the type from the candidate's passed reviews
--     (talent_verifications), which says nothing about WHO IS LISTED: the listing rule is still written only in the helper.
--   * The applicant list is still not gated on directory opt-in (0170): an employer sees whether the resume of someone who applied to them was reviewed
--     (and by whom, and when) whether or not that person is listed. It still hides people who asked to delete their account (0212).
--   * Grants. Both functions keep exactly the grants they have: authenticated and service_role, nothing for anon or public.
--
-- search_path. talent_directory_search was 'public'; it is now '' like the applicant function. Every table and function it names is already schema-qualified
-- (public.*, auth.uid()), and the built-ins it uses (now, least, greatest, coalesce) live in pg_catalog, which is always searched. A DROP also drops a
-- function's COMMENT, so the search's comment is written again below.
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
    case when p.talent_verification_status = 'verified' then 'verified' end,
    a.screening_passed,
    case when p.talent_verification_status = 'verified' then p.talent_verified_at end,
    case when p.talent_verification_status = 'verified' then (
      select tv.review_type
      from public.talent_verifications tv
      where tv.user_id = p.id and tv.status = 'verified'
      order by tv.decided_at desc nulls last, tv.requested_at desc
      limit 1
    ) end
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
  'Per-applicant rows for ONE job posting, scoped to the caller''s own organisation, sorted by match score (highest first, unscored last). Never returns email, applications.notes, or applications.stage (seeker-private, 0037) — only name, applied_at, resume_id, the employer''s own status (default new), the seeker-side match score/explanation (match_scores, read-only here), whether the resume review passed (talent_verification_status, 0234: ''verified'' or null, never a pending, rejected or unreviewed state; profiles, read-only here, NOT gated on talent_directory_opt_in), the review date and who reviewed (talent_verified_at and talent_review_type, 0234: the stored review_type of the latest passed review, ''ai'' = Farah or ''human'' = a mentor, null when the resume is not reviewed or no passed review row exists) — never the review score, and screening_passed (applications, 0171 — null means no screening questions or answers incomplete, never gates whether the application itself was accepted). People who asked to delete their account are not listed (0212).';

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
  verified_at timestamp with time zone,
  review_type text
)
language plpgsql
stable
security definer
set search_path = ''
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
           p.talent_verified_at,
           (select tv.review_type
            from public.talent_verifications tv
            where tv.user_id = p.id and tv.status = 'verified'
            order by tv.decided_at desc nulls last, tv.requested_at desc
            limit 1)
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

comment on function public.talent_directory_search(boolean, boolean, integer, integer, uuid) is
  'The paid Talent Directory search: candidates in talent_directory_listed_ids() (the only place the listing rule is written), for a member of an organisation with an active subscription. Returns the name, country, availability, remote-readiness, earliest start date, the date the resume was reviewed and who reviewed it (review_type, 0234: the stored review_type of the latest passed review, ai = Farah or human = a mentor, null if no passed review row exists). Never returns a review score (0234): no score reaches an employer.';
