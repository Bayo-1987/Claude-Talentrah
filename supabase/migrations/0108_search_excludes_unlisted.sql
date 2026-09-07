-- 0108: the full-text search RPC must not list what the feed hides.
--
-- ── A HOLE 0107 OPENED, FOUND BEFORE MERGE ────────────────────────────────
--
-- 0107 widened the `job postings are publicly readable` policy so a row with
-- `unlisted_at` set is readable by anyone holding its id. Every LISTING
-- surface then had to exclude those rows itself, because none of them ever
-- filtered on `verified` — they relied on RLS to hide unverified orgs for
-- them. Fourteen query sites were updated for exactly that reason.
--
-- `search_job_postings` (0100) is the fifteenth, and it was missed because it
-- is SQL, not a PostgREST call — nothing in the TypeScript diff pointed at it.
-- It is `security invoker`, so RLS applies to it and the widened policy admits
-- unlisted rows; its own WHERE clause filters status, freshness, source type,
-- work type, seniority and ids, and said nothing about `unlisted_at`. The
-- result: an unlisted posting stayed out of the feed and appeared the moment
-- anyone typed a word from it into the search box.
--
-- 0100's own header is the reason this was easy to miss, and it is corrected
-- here rather than left to mislead the next reader: it argued INVOKER was safe
-- because the function is "exactly as visible, to exactly the same rows, as a
-- plain select the caller could already run". That was true, and it is still
-- true — what changed is that the set of rows a caller can already select got
-- bigger. An argument that delegates to a policy inherits every later widening
-- of it.
--
-- ── WHY THIS IS ITS OWN MIGRATION AND NOT AN EDIT TO 0107 ─────────────────
--
-- 0107 is already applied to the CI project (as in-review migrations are, per
-- CLAUDE.md). Editing it would leave a file whose text no database had run,
-- and would need ad-hoc SQL to reconcile CI. A separate forward step applies
-- cleanly to both, in order, by the same tracked path — and it records the
-- finding instead of hiding it inside a file that claims to have been right
-- all along. Production receives both together on merge, so no window exists
-- in which the search leak is live.
--
-- ── WHY is_org_member AND NOT A BARE `unlisted_at is null` ────────────────
--
-- Matching the feed's own rule (Option A, founder-decided): an org member
-- keeps seeing their own posting after it is minted, because minting happens
-- automatically on the next Jobs Posted render and a job vanishing from the
-- poster's own search results, moments after they posted it, is a worse
-- regression than the one being fixed.
--
-- `is_org_member` is the predicate 0026 wrote for this and the one the RLS
-- policy itself uses, so the function and the policy cannot drift apart into
-- two different definitions of "my organisation". It is SECURITY DEFINER over
-- `auth.uid()`, and this function is INVOKER, so it resolves to the CALLER —
-- not to whoever defined it. For `service_role` (no auth.uid()) it is false,
-- which excludes unlisted rows: the safe direction for a backend caller.

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
    -- NEW (0108). Mirrors the /jobs feed exactly: unlisted is link-only for
    -- everyone except the org that posted it.
    and (j.unlisted_at is null or public.is_org_member(j.organization_id))
    and j.search_vector @@ websearch_to_tsquery('english', p_query)
    and (p_source_type is null or j.source_type = p_source_type)
    -- Same "null means no filter, empty array matches nothing" contract
    -- postingsQuery() and promoted_jobs both use.
    and (p_work_types is null or j.work_type = any (p_work_types))
    and (p_seniorities is null or j.seniority = any (p_seniorities))
    and (p_ids is null or j.id = any (p_ids))
  order by rank desc, j.posted_at desc;
$$;

-- `create or replace` preserves privileges, so 0100's grants still stand. Not
-- re-asserted here on purpose: re-stating a grant list is what broke 0085's
-- salary columns during 0107's own first draft. Asserted instead, so a real
-- regression fails the migration rather than being silently re-granted.
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
