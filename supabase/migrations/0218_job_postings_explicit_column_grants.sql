-- 0218: explicit column grants on public.job_postings.
--
-- anon and authenticated read this table through the API. Until now they held the table-level SELECT grant, which covers every
-- column, including any column added later. This replaces it with one SELECT grant per column, listed below, so a column is readable by
-- those roles only when a migration says so. The service role is untouched (it bypasses this), and no UPDATE, INSERT or DELETE
-- privilege changes.
--
-- Every other column keeps being readable exactly as before; the page, feed, search, sitemap and SEO queries name their columns
-- (src/lib/jobs/job-columns.ts and tests/jobs/job-postings-explicit-columns.test.ts), so none of them changes behaviour.
--
-- A column added to job_postings from now on needs its own `grant select (<col>) on public.job_postings to anon, authenticated`
-- in the migration that adds it, or the first read of it fails with 42501 (permission denied for column). The guard below and
-- tests/rls/job-postings-column-grants.test.ts hold that.

-- Fail fast instead of queueing behind a long query on this table: the migration is retried, not waited for.
set local lock_timeout = '3s';

revoke select on public.job_postings from anon, authenticated;

grant select (
  id, source_type, organization_id, title, company_name, company_logo_url, location, work_type, employment_type, seniority,
  years_experience_min, description, structured_jd, external_url, external_source, status, posted_at, last_checked_at,
  dedup_fingerprint, created_at, expires_at, removed_at, removal_reason, removed_by, salary_min, salary_max, salary_currency,
  salary_unit, description_preview, search_vector, closed_at, unlisted_at, banner_path, admin_review_requested_at,
  admin_review_decision, admin_reviewed_at, admin_reviewed_by, claimed_by_organization_id, claimed_at,
  llm_enrichment_attempted_at, superseded_by, superseded_at, closing_date_source
) on public.job_postings to anon, authenticated;

-- Guard (mirrors 0119's UPDATE guard): after this migration, every column of the table except the one deliberately left out must be
-- selectable by both roles, and that one by neither.
do $$
declare
  bad text;
begin
  select string_agg(c.column_name || ' (' || r.role || ')', ', ')
    into bad
  from information_schema.columns c
  cross join (values ('anon'), ('authenticated')) as r(role)
  where c.table_schema = 'public' and c.table_name = 'job_postings'
    and c.column_name <> 'admin_review_note'
    and not has_column_privilege(r.role, 'public.job_postings', c.column_name, 'SELECT');
  if bad is not null then
    raise exception 'job_postings columns not selectable after 0218: %', bad;
  end if;

  if has_column_privilege('anon', 'public.job_postings', 'admin_review_note', 'SELECT')
     or has_column_privilege('authenticated', 'public.job_postings', 'admin_review_note', 'SELECT') then
    raise exception 'a column that must stay unreadable by anon and authenticated is still readable';
  end if;
end $$;
