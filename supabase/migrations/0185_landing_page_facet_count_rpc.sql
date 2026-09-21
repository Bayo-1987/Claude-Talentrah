-- send-441: collapse the SEO landing-page "explore more" facet-count fan-out
-- into one round trip per domain.
--
-- src/lib/seo/landing-page-links.ts's liveJobLandingLinks ran 1 (remote) + 4
-- (tracked countries) + 3 (curated cities) = 8 separate count(*) queries, and
-- liveScholarshipLandingLinks ran 1 (fully-funded) + 5 (degree levels) = 6.
-- Both are declared force-dynamic and deliberately uncached (see
-- landing-page-data.ts's own header), and both run on every landing page AND
-- every /jobs/[id] or /scholarships/[id] detail page render via
-- relevantJobLandingLinks/relevantScholarshipLandingLinks, which only need
-- one or two of the facets but paid for all of them anyway.
--
-- Each function below replaces its fan-out with ONE query: a single scan of
-- the table with one count(*) FILTER (WHERE ...) per facet, sharing the same
-- base WHERE clause the individual queries already applied. This is a
-- round-trip win (8 or 6 requests to Supabase's REST gateway become 1), not
-- a claim that the underlying table is scanned fewer times than before.
--
-- The per-facet conditions are copied from, not derived from, the TypeScript
-- constants they mirror (src/lib/jobs/country.ts's TRACKED_COUNTRIES/
-- SOURCE_COUNTRY_FALLBACK, src/lib/seo/landing-pages.ts's
-- CITY_LANDING_PAGES). That is real, deliberate duplication — the same
-- trade-off countryOrFilter's own comment already accepts for the JS/SQL
-- split on this exact data. tests/seo/landing-page-facet-rpc.test.ts is the
-- drift detector: it asserts this RPC's counts against the SAME live data
-- the pre-existing per-facet queries (still called directly in that test,
-- not removed) compute, so an edit to one side that forgets the other fails
-- loudly instead of silently drifting.
--
-- security invoker (the default) is deliberate, not an oversight — see
-- CLAUDE.md's own standing note on 0107/0108/0109: a SECURITY DEFINER
-- function here would silently opt out of job_postings'/scholarships' RLS
-- policies. These functions read only what an anonymous visitor's own RLS
-- policy already lets them read, so invoker is both sufficient and correct.

create or replace function public.job_landing_facet_counts(p_floor timestamptz)
returns table (
  remote_count bigint,
  nigeria_count bigint,
  ghana_count bigint,
  kenya_count bigint,
  south_africa_count bigint,
  lagos_count bigint,
  abuja_count bigint,
  nairobi_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) filter (where work_type = 'remote') as remote_count,
    -- Nigeria: literal name match OR one of its single-country-source blind
    -- fallbacks (src/lib/jobs/country.ts SOURCE_COUNTRY_FALLBACK).
    count(*) filter (
      where work_type = 'remote'
        and (
          location ilike '%Nigeria%'
          or external_source in (
            'schema-org:workable-nigeria',
            'schema-org:workable-lagos',
            'schema-org:workable-abuja',
            'schema-org:workable-ibadan',
            'schema-org:workable-port-harcourt'
          )
        )
    ) as nigeria_count,
    count(*) filter (
      where work_type = 'remote'
        and (location ilike '%Ghana%' or external_source = 'schema-org:workable-ghana')
    ) as ghana_count,
    count(*) filter (
      where work_type = 'remote'
        and (location ilike '%Kenya%' or external_source = 'schema-org:workable-kenya')
    ) as kenya_count,
    count(*) filter (
      where work_type = 'remote'
        and (location ilike '%South Africa%' or external_source = 'schema-org:workable-south-africa')
    ) as south_africa_count,
    -- Cities (src/lib/seo/landing-pages.ts CITY_LANDING_PAGES) — no
    -- work_type filter, matching loadCityJobs/the original city loop.
    count(*) filter (where location ilike '%lagos%') as lagos_count,
    count(*) filter (
      where location ilike '%abuja%'
         or location ilike '%fct%'
         or location ilike '%federal capital territory%'
    ) as abuja_count,
    count(*) filter (where location ilike '%nairobi%') as nairobi_count
  from public.job_postings
  where unlisted_at is null
    and status = 'open'
    and posted_at >= p_floor;
$$;

comment on function public.job_landing_facet_counts(timestamptz) is
  'send-441: one-round-trip replacement for liveJobLandingLinks'' 8-query fan-out. Keep in sync with src/lib/jobs/country.ts and src/lib/seo/landing-pages.ts by hand — tests/seo/landing-page-facet-rpc.test.ts fails on drift.';

grant execute on function public.job_landing_facet_counts(timestamptz) to anon, authenticated;

create or replace function public.scholarship_landing_facet_counts(p_today date)
returns table (
  fully_funded_count bigint,
  bsc_count bigint,
  msc_count bigint,
  phd_count bigint,
  postgraduate_diploma_count bigint,
  other_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) filter (where funding_type = 'full') as fully_funded_count,
    count(*) filter (where degree_levels @> array['bsc']::public.scholarship_degree_level[]) as bsc_count,
    count(*) filter (where degree_levels @> array['msc']::public.scholarship_degree_level[]) as msc_count,
    count(*) filter (where degree_levels @> array['phd']::public.scholarship_degree_level[]) as phd_count,
    count(*) filter (
      where degree_levels @> array['postgraduate_diploma']::public.scholarship_degree_level[]
    ) as postgraduate_diploma_count,
    count(*) filter (where degree_levels @> array['other']::public.scholarship_degree_level[]) as other_count
  from public.scholarships
  where moderation_status = 'verified'
    and (application_deadline is null or application_deadline >= p_today);
$$;

comment on function public.scholarship_landing_facet_counts(date) is
  'send-441: one-round-trip replacement for liveScholarshipLandingLinks'' 6-query fan-out. tests/seo/landing-page-facet-rpc.test.ts fails on drift from the degree-level enum or the still-open filter.';

grant execute on function public.scholarship_landing_facet_counts(date) to anon, authenticated;
