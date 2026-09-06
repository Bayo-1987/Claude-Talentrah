-- Stage 8 step 2 (docs/stage8-match-accuracy.md): real full-text search over
-- job postings, replacing the feed search box's in-memory substring pass for
-- ACTUAL RESULTS. src/lib/jobs/search.ts stays in place, unchanged, and keeps
-- doing exactly what it always did for src/lib/jobs/search-suggestions.ts's
-- typeahead counts — that index is built from the board BEFORE the search
-- term and never touches this function. This migration only changes what
-- happens once a term is actually searched.
--
-- ── WHY NOT `.textSearch()` ALONE ─────────────────────────────────────────
-- postgrest-js's `.textSearch(column, query, {type: 'websearch'})` parameter-
-- izes the query value through `URLSearchParams` (confirmed by reading
-- PostgrestFilterBuilder.ts) — it is not string-built SQL, so it would have
-- been the simpler fix. But it only emits a FILTER (`column @@
-- websearch_to_tsquery(...)`); PostgREST's `.order()` takes a column name, not
-- a runtime expression, so there is no client-side way to sort by
-- `ts_rank(search_vector, query)` — the rank depends on the query itself, not
-- on a stored column. Hence an RPC: it can compute and sort by that
-- expression server-side, while still taking `p_query` as a bound parameter
-- exactly the way `.textSearch()` would have.
--
-- ── THE COLUMN AND ITS WEIGHTS ─────────────────────────────────────────────
-- GENERATED ... STORED, not maintained by a trigger, so it can never drift
-- from title/company_name/structured_jd/description the way a
-- separately-updated column could. Generated columns cannot reference another
-- generated column or run a subquery, which is why this reads `description`
-- directly (not `description_preview`) and pulls skills via a plain jsonb->
-- text cast (`(structured_jd->'skills')::text`, tokenizing e.g.
-- '["python","sql"]' into the lexemes python/sql — verified live) rather than
-- `jsonb_array_elements_text`, which is a set-returning function and would
-- make this a disallowed subquery.
--
-- Four weight tiers, highest first:
--   A — title              the strongest, most specific signal a reader typed
--   B — structured_jd.skills  extracted, high-precision exact terms (Stage 8
--                             step 1a); a "python" search should rank a
--                             skill-tagged posting above one that merely
--                             mentions "company culture" once in passing
--   C — company_name       a real but weaker signal than what the role is
--   D — description        thousands of words of prose; still searched (this
--                           is the whole point of step 2 — see the numbers
--                           search.ts's own header cites: excel/sql/python/
--                           kubernetes matched via structured_jd.skills but
--                           NOT via the old title/company/location substring
--                           pass) but ranked last so a title or skill hit
--                           always outranks an incidental body-text mention.
--
-- ── SECURITY INVOKER, NOT DEFINER ──────────────────────────────────────────
-- Unlike promoted_jobs (0095), this needs no elevated privilege — it reads
-- only job_postings, which already has its own "publicly readable" SELECT
-- policy (external+not-removed, OR verified-org internal+not-removed, OR
-- org member — confirmed live against production). INVOKER means this
-- function is exactly as visible, to exactly the same rows, as a plain
-- `select` the caller could already run; it changes nothing about who can see
-- what.
--
-- ── NO PAGINATION, STILL ───────────────────────────────────────────────────
-- Board size confirmed live at merge time: 298 open, posted-within-30-days
-- rows (unchanged from the count `search.ts`'s own header and step 1a's
-- measurement used). This function still filters the same order of magnitude
-- of rows a client-side `.includes()` pass did — a GIN-indexed
-- `@@` lookup over 298 rows costs nothing worth measuring. Moving the query
-- server-side here is about correct ranking and searching the full
-- description, not about row count, so it does not itself require adding
-- pagination; the feed's base (non-search) fetch is untouched and still
-- returns the whole filtered board in one round trip, same as before.

alter table public.job_postings
  add column search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce((structured_jd -> 'skills')::text, '')), 'B')
    || setweight(to_tsvector('english', coalesce(company_name, '')), 'C')
    || setweight(to_tsvector('english', coalesce(description, '')), 'D')
  ) stored;

create index job_postings_search_vector_idx on public.job_postings using gin (search_vector);

-- Same narrow projection jobs/page.tsx's FEED_COLUMNS already selects
-- (`description_preview` aliased back to `description`) — this must stay a
-- named column list, not `returns setof job_postings`, or every search
-- request would pull the full multi-KB `description` body per row instead of
-- the ~280-char preview the feed actually renders (see FEED_COLUMNS's own
-- comment on why that split exists).
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
    and j.search_vector @@ websearch_to_tsquery('english', p_query)
    and (p_source_type is null or j.source_type = p_source_type)
    -- Same "null means no filter, empty array matches nothing" contract
    -- postingsQuery() and promoted_jobs both use.
    and (p_work_types is null or j.work_type = any (p_work_types))
    and (p_seniorities is null or j.seniority = any (p_seniorities))
    and (p_ids is null or j.id = any (p_ids))
  order by rank desc, j.posted_at desc;
$$;

revoke all on function public.search_job_postings(
  text, timestamptz, public.job_source_type, public.work_type[], public.seniority_level[], uuid[]
) from public, anon;
-- Both roles, matching every other RPC in this schema (promoted_jobs 0095,
-- internal_applicant_counts 0059) rather than relying on service_role having
-- this by ambient default — checked live, not assumed: those two are only
-- callable by service_role because their own migrations grant it explicitly.
grant execute on function public.search_job_postings(
  text, timestamptz, public.job_source_type, public.work_type[], public.seniority_level[], uuid[]
) to authenticated, service_role;
