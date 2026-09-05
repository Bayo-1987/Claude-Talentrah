-- Widen promoted_jobs' work-type/seniority filters from a single value to
-- arrays, matching the jobs feed's own move to multi-select work type and
-- seniority (?workType=remote,hybrid). D1 (0052's own header) requires a
-- promoted slot to satisfy the seeker's ACTIVE filters exactly as an organic
-- result does — a promoted job is already IN the feed's own filtered set
-- (jobs/page.tsx only reorders it in, never adds one outside the filters), so
-- a single-value promoted_jobs call left behind by the multi-select feed
-- would silently under-filter this one path: a promoted card could clear a
-- work_type that isn't even one of the two the reader picked, because the
-- old signature could only ever be told about one.
--
-- The old signature is dropped rather than left as a second overload — a
-- caller that still passes a bare work_type/seniority_level would silently
-- keep working against stale, single-value behaviour, which is exactly the
-- kind of quietly-diverging duplicate this project avoids elsewhere.
drop function if exists public.promoted_jobs(integer, public.work_type, public.seniority_level, integer);

create or replace function public.promoted_jobs(
  p_min_score integer default 60,
  p_work_types public.work_type[] default null,
  p_seniorities public.seniority_level[] default null,
  p_limit integer default 2
)
returns table (job_posting_id uuid, campaign_id uuid, match_score integer)
language sql
stable
security definer
set search_path = public
as $$
  select j.id, c.id, ms.score
    from public.ad_campaigns c
    join public.job_postings j
      on j.id = c.job_posting_id
     and j.status = 'open'
    join public.match_scores ms
      on ms.job_posting_id = j.id
     and ms.user_id = (select auth.uid())
   where (select auth.uid()) is not null
     and c.status = 'active'
     and (c.ends_on is null or current_date <= c.ends_on)
     -- D1: the seeker's own filters and threshold bind a paid slot exactly as
     -- they bind an organic one. A null array means "no filter applied" —
     -- the feed passes null, not an empty array, when a dimension is unset.
     and ms.score >= p_min_score
     and (p_work_types is null or j.work_type = any (p_work_types))
     and (p_seniorities is null or j.seniority = any (p_seniorities))
     -- The employer's targeting, unchanged.
     and (c.target_locations is null or j.location = any (c.target_locations))
     and (c.target_seniority is null or j.seniority = any (c.target_seniority))
     and (c.target_employment_type is null or j.employment_type = any (c.target_employment_type))
   order by ms.score desc, c.created_at asc
   limit greatest(p_limit, 0);
$$;

revoke all on function public.promoted_jobs(integer, public.work_type[], public.seniority_level[], integer)
  from public, anon;
grant execute on function public.promoted_jobs(integer, public.work_type[], public.seniority_level[], integer)
  to authenticated, service_role;
