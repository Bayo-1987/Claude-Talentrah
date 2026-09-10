-- 0127 — a Path 3-approved posting stayed invisible to the discovery feed,
-- and to search alongside it.
--
-- Found live 2026-09-10: "Senior Product Manager" carried both
-- `PRIVATE LINK ONLY` and `APPROVED FOR THE FEED` badges on /employer/jobs,
-- but never appeared on the public /jobs feed. 0119's own RLS SELECT policy
-- is correct and grants exactly what the badge promises — its own comment
-- says the Path 3 branch is "[d]eliberately independent of ...
-- unlisted_at". The bug is that every app-level surface reading
-- `job_postings` for the public feed applies its OWN `unlisted_at` filter
-- (written for 0107, before Path 3 existed) and never learned about 0119's
-- later, independent grant — the exact "which functions read this table,
-- and does each one inherit the policy or replace it" question this
-- codebase's own history (0107/0108/0109) already says to ask.
--
-- Three of the four surfaces are plain PostgREST queries in
-- src/app/(app)/jobs/page.tsx (postingsQuery, boardAggregateQuery,
-- paginatedRecentQuery) and are fixed there, in the same commit as this
-- migration, by adding `admin_review_decision.eq.approved` as a third
-- OR-branch alongside the existing unlisted-at/own-org one.
--
-- `search_job_postings` (0100, hardened in 0108 for exactly this class of
-- gap) is the fourth, and it is SQL — no TypeScript diff points at it, which
-- is precisely how 0108 itself was missed the first time. It is
-- `security invoker`, so 0119's widened RLS admits an approved row to it,
-- and its own WHERE clause said nothing about `admin_review_decision`.
-- Uncorrected, a Path 3-approved posting would have stayed out of search
-- results the same way it stayed out of the feed.
create or replace function public.search_job_postings(
  p_query text,
  p_since timestamptz,
  p_source_type public.job_source_type default null,
  p_work_types public.work_type[] default null,
  p_seniorities public.seniority_level[] default null,
  p_ids uuid[] default null
)
returns table (
  id uuid,
  source_type public.job_source_type,
  organization_id uuid,
  title text,
  company_name text,
  company_logo_url text,
  location text,
  work_type public.work_type,
  employment_type public.employment_type,
  seniority public.seniority_level,
  years_experience_min integer,
  description text,
  structured_jd jsonb,
  external_url text,
  external_source text,
  status public.job_status,
  posted_at timestamptz,
  last_checked_at timestamptz,
  dedup_fingerprint text,
  created_at timestamptz,
  expires_at timestamptz,
  removed_at timestamptz,
  removal_reason text,
  removed_by uuid,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  salary_unit public.salary_unit,
  rank real
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    j.id,
    j.source_type,
    j.organization_id,
    j.title,
    j.company_name,
    j.company_logo_url,
    j.location,
    j.work_type,
    j.employment_type,
    j.seniority,
    j.years_experience_min,
    j.description_preview,
    j.structured_jd,
    j.external_url,
    j.external_source,
    j.status,
    j.posted_at,
    j.last_checked_at,
    j.dedup_fingerprint,
    j.created_at,
    j.expires_at,
    j.removed_at,
    j.removal_reason,
    j.removed_by,
    j.salary_min,
    j.salary_max,
    j.salary_currency,
    j.salary_unit,
    ts_rank(j.search_vector, websearch_to_tsquery('english', p_query)) as rank
  from public.job_postings j
  where j.status = 'open'
    and j.posted_at >= p_since
    -- 0108's own rule, unchanged: unlisted is link-only except for the
    -- posting org itself.
    -- NEW (0127): OR a Path 3 approval — mirrors the feed's own fix and
    -- RLS's own independence from unlisted_at (0119).
    and (
      j.unlisted_at is null
      or public.is_org_member(j.organization_id)
      or j.admin_review_decision = 'approved'
    )
    and j.search_vector @@ websearch_to_tsquery('english', p_query)
    and (p_source_type is null or j.source_type = p_source_type)
    -- Same "null means no filter, empty array matches nothing" contract
    -- postingsQuery() and promoted_jobs both use.
    and (p_work_types is null or j.work_type = any (p_work_types))
    and (p_seniorities is null or j.seniority = any (p_seniorities))
    and (p_ids is null or j.id = any (p_ids))
  order by rank desc, j.posted_at desc;
$$;

-- `create or replace` preserves privileges, so 0100/0108's grants still
-- stand. Not re-asserted here on purpose: re-stating a grant list is what
-- broke 0085's salary columns during 0107's own first draft. Asserted
-- instead, so a real regression fails the migration rather than being
-- silently re-granted.
do $$
begin
  if has_function_privilege(
       'anon',
       'public.search_job_postings(text, timestamptz, public.job_source_type, public.work_type[], public.seniority_level[], uuid[])',
       'execute'
     ) then
    raise exception
      'search_job_postings is executable by anon; 0100 revoked it and this function reads rows anon must reach only by id.';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.search_job_postings(text, timestamptz, public.job_source_type, public.work_type[], public.seniority_level[], uuid[])',
       'execute'
     ) then
    raise exception
      'search_job_postings lost its authenticated EXECUTE grant; the job feed search box would 404 for every signed-in user.';
  end if;
end $$;
