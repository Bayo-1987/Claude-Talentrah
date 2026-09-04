import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findCityLandingPage, degreeLevelFromSlug, type CityLandingPage } from "./landing-pages";
import type { Database, Tables } from "@/lib/supabase/types";
import type { DegreeLevel } from "@/lib/scholarships/types";
import { freshnessFloorISO } from "@/lib/jobs/freshness";
import { countryFromSlug, countryOrFilter, type TrackedCountry } from "@/lib/jobs/country";

/**
 * Typed generically as `SupabaseClient<Database>` rather than the return
 * type of src/lib/supabase/server.ts's own `createClient()` — that helper
 * calls next/headers' `cookies()`, which needs an active Next.js request and
 * cannot run inside a plain test. Every real page.tsx still passes it the
 * real request-scoped client; tests pass a plain anon-key client instead
 * (the same pattern tests/rls/column-privileges.test.ts already uses for
 * its own anonClient), which is structurally identical for read-only,
 * RLS-scoped queries like these.
 */
type Client = SupabaseClient<Database>;

/**
 * Every SEO landing page's data-fetching, factored out of its page.tsx so
 * it is testable without a Next.js render harness — the same `total` this
 * returns is what each page compares against LANDING_PAGE_MIN_ENTRIES to
 * decide notFound() vs render, so testing THIS is testing the real gate.
 *
 * NO CACHING ANYWHERE IN THIS FILE, on purpose. Every function issues a
 * fresh Supabase query on every call — there is no memoization, no
 * `unstable_cache`, no module-level variable holding a prior result. Each
 * page.tsx that calls one of these also declares `export const dynamic =
 * "force-dynamic"`, which stops Next.js from statically generating the page
 * at build time or serving a cached response for a request that looks
 * identical to a previous one — the two together are what make "a category
 * that empties out drops off the same run it happens" true rather than
 * aspirational. See tests/seo/landing-page-liveness.test.ts for the proof:
 * two calls to the SAME loader, with real rows opened and closed on the
 * live database between them, return different totals — nothing in this
 * file could do that if a build-time or memoized value were involved.
 */
const PAGE_LIMIT = 30;

/**
 * Omit, not the full row: `description` alone averages ~5.4 KB of a ~7.3 KB
 * job_postings row (measured 2026-09-03), to render a card that only ever
 * shows 220 characters of it (public-job-row.tsx). Both loaders below fetch
 * it pre-truncated via the generated `description_preview` column
 * (migration 0086), aliased back to `description` — see jobs/page.tsx's
 * identical FEED_COLUMNS for the fuller explanation and why this needs to
 * be one string literal, not a concatenated or externally-typed one.
 */
type LandingJobPosting = Omit<Tables<"job_postings">, "description_preview">;
const JOB_LANDING_COLUMNS =
  "id, source_type, organization_id, title, company_name, company_logo_url, location, work_type, employment_type, seniority, years_experience_min, description:description_preview, structured_jd, external_url, external_source, status, posted_at, last_checked_at, dedup_fingerprint, created_at, expires_at, removed_at, removal_reason, removed_by, salary_min, salary_max, salary_currency, salary_unit";

export interface JobLandingResult {
  total: number;
  jobs: LandingJobPosting[];
}

export async function loadRemoteJobs(
  supabase: Client,
): Promise<JobLandingResult> {
  // The same 30-day floor every discovery surface enforces
  // (src/lib/jobs/freshness.ts) — this loader has no shared choke point
  // with the feed, so it needs its own copy of the filter.
  const floor = freshnessFloorISO();

  const { count, error: countError } = await supabase
    .from("job_postings")
    .select("id", { count: "exact", head: true })
    .eq("status", "open")
    .eq("work_type", "remote")
    .gte("posted_at", floor);
  if (countError) throw new Error(countError.message);

  const { data, error } = await supabase
    .from("job_postings")
    .select(JOB_LANDING_COLUMNS)
    .eq("status", "open")
    .eq("work_type", "remote")
    .gte("posted_at", floor)
    .order("posted_at", { ascending: false })
    .limit(PAGE_LIMIT);
  if (error) throw new Error(error.message);

  return { total: count ?? 0, jobs: (data ?? []) as LandingJobPosting[] };
}

export interface CountryRemoteJobLandingResult extends JobLandingResult {
  country: TrackedCountry;
}

/**
 * Remote roles filtered to ONE tracked country — the honest per-country
 * claim /jobs/remote itself deliberately dropped (see that page.tsx's own
 * header). `countryOrFilter` matches deriveCountry's own logic at the SQL
 * level: a literal country name in `location`, OR (when blind) the source's
 * own declared country for a single-country schema-org board — see
 * src/lib/jobs/country.ts for the full reasoning and why the two can't
 * independently drift.
 */
export async function loadCountryRemoteJobs(
  supabase: Client,
  countrySlug: string,
): Promise<CountryRemoteJobLandingResult | null> {
  const country = countryFromSlug(countrySlug);
  if (!country) return null;

  const floor = freshnessFloorISO();
  const orFilter = countryOrFilter(country);

  const { count, error: countError } = await supabase
    .from("job_postings")
    .select("id", { count: "exact", head: true })
    .eq("status", "open")
    .eq("work_type", "remote")
    .or(orFilter)
    .gte("posted_at", floor);
  if (countError) throw new Error(countError.message);

  const { data, error } = await supabase
    .from("job_postings")
    .select(JOB_LANDING_COLUMNS)
    .eq("status", "open")
    .eq("work_type", "remote")
    .or(orFilter)
    .gte("posted_at", floor)
    .order("posted_at", { ascending: false })
    .limit(PAGE_LIMIT);
  if (error) throw new Error(error.message);

  return { country, total: count ?? 0, jobs: (data ?? []) as LandingJobPosting[] };
}

export interface CityJobLandingResult extends JobLandingResult {
  city: CityLandingPage;
}

export async function loadCityJobs(
  supabase: Client,
  citySlug: string,
): Promise<CityJobLandingResult | null> {
  const city = findCityLandingPage(citySlug);
  if (!city) return null;

  const orFilter = city.locationPatterns.map((p) => `location.ilike.${p}`).join(",");
  const floor = freshnessFloorISO();

  const { count, error: countError } = await supabase
    .from("job_postings")
    .select("id", { count: "exact", head: true })
    .eq("status", "open")
    .or(orFilter)
    .gte("posted_at", floor);
  if (countError) throw new Error(countError.message);

  const { data, error } = await supabase
    .from("job_postings")
    .select(JOB_LANDING_COLUMNS)
    .eq("status", "open")
    .or(orFilter)
    .gte("posted_at", floor)
    .order("posted_at", { ascending: false })
    .limit(PAGE_LIMIT);
  if (error) throw new Error(error.message);

  return { city, total: count ?? 0, jobs: (data ?? []) as LandingJobPosting[] };
}

export interface ScholarshipLandingResult {
  total: number;
  scholarships: Tables<"scholarships">[];
}

function stillOpenFilter(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `application_deadline.is.null,application_deadline.gte.${today}`;
}

export async function loadFullyFundedScholarships(
  supabase: Client,
): Promise<ScholarshipLandingResult> {
  const stillOpen = stillOpenFilter();

  const { count, error: countError } = await supabase
    .from("scholarships")
    .select("id", { count: "exact", head: true })
    .eq("moderation_status", "verified")
    .eq("funding_type", "full")
    .or(stillOpen);
  if (countError) throw new Error(countError.message);

  const { data, error } = await supabase
    .from("scholarships")
    .select("*")
    .eq("moderation_status", "verified")
    .eq("funding_type", "full")
    .or(stillOpen)
    .order("application_deadline", { ascending: true, nullsFirst: false })
    .limit(PAGE_LIMIT);
  if (error) throw new Error(error.message);

  return { total: count ?? 0, scholarships: (data ?? []) as Tables<"scholarships">[] };
}

export interface DegreeLevelLandingResult extends ScholarshipLandingResult {
  level: DegreeLevel;
}

export async function loadScholarshipsByLevel(
  supabase: Client,
  levelSlug: string,
): Promise<DegreeLevelLandingResult | null> {
  const level = degreeLevelFromSlug(levelSlug);
  if (!level) return null;

  const stillOpen = stillOpenFilter();

  const { count, error: countError } = await supabase
    .from("scholarships")
    .select("id", { count: "exact", head: true })
    .eq("moderation_status", "verified")
    .contains("degree_levels", [level])
    .or(stillOpen);
  if (countError) throw new Error(countError.message);

  const { data, error } = await supabase
    .from("scholarships")
    .select("*")
    .eq("moderation_status", "verified")
    .contains("degree_levels", [level])
    .or(stillOpen)
    .order("application_deadline", { ascending: true, nullsFirst: false })
    .limit(PAGE_LIMIT);
  if (error) throw new Error(error.message);

  return { level, total: count ?? 0, scholarships: (data ?? []) as Tables<"scholarships">[] };
}
