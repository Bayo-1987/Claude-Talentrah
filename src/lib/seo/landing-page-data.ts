import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findCityLandingPage, degreeLevelFromSlug, type CityLandingPage } from "./landing-pages";
import type { Database, Tables } from "@/lib/supabase/types";
import type { DegreeLevel } from "@/lib/scholarships/types";
import { freshnessFloorISO } from "@/lib/jobs/freshness";
import { countryFromSlug, countryOrFilter, type TrackedCountry } from "@/lib/jobs/country";
import { openScholarshipFilter } from "@/lib/scholarships/close-instant";

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
type LandingJobPosting = Omit<Tables<"job_postings">, "description_preview" | "search_vector" | "unlisted_at" | "banner_path" | "admin_review_decision" | "admin_review_note" | "admin_review_requested_at" | "admin_reviewed_at" | "admin_reviewed_by" | "claimed_by_organization_id" | "claimed_at" | "llm_enrichment_attempted_at">;
const JOB_LANDING_COLUMNS =
  "id, source_type, organization_id, title, company_name, company_logo_url, location, work_type, employment_type, seniority, years_experience_min, description:description_preview, structured_jd, external_url, external_source, status, posted_at, last_checked_at, dedup_fingerprint, created_at, expires_at, removed_at, removal_reason, removed_by, salary_min, salary_max, salary_currency, salary_unit";

export interface JobLandingResult {
  total: number;
  jobs: LandingJobPosting[];
}

/**
 * NO ItemList/CollectionPage STRUCTURED DATA ON ANY PAGE THAT CALLS THESE
 * LOADERS, DELIBERATELY — checked against Google's current documentation
 * rather than shipped on an SEO checklist's assumption of what "good schema"
 * looks like, the same discipline `faq-section.tsx` already applies to
 * FAQPage. Two independent checks (2026-09-18), not one:
 *
 *   1. Google's own JobPosting documentation states outright: "Don't add
 *      structured data to pages intended to present a list of jobs (for
 *      example, search result pages)" — and, in its troubleshooting section,
 *      "JobPosting structured data must only be on a job posting page (a
 *      page that contains a single job and isn't a search results page)."
 *      `/jobs/remote`, `/jobs/in/[city]` and `/jobs/remote/[country]` are
 *      exactly that shape of page.
 *   2. Google's separate Carousel (ItemList) documentation lists its own
 *      closed set of eligible content types — Course list, Movie, Recipe,
 *      Restaurant — and JobPosting is not among them, so ItemList would not
 *      even be a mechanism Google recognises for this content type, in
 *      addition to (1) actively telling sites not to try.
 *
 * So this would ship dead markup — no rich result, no carousel eligibility —
 * while costing payload on a low-end-Android-targeted product for zero
 * return, the identical shape of cost `faq-section.tsx`'s own FAQPage
 * decision already reasons through. If this ever needs revisiting, it's
 * because Google's guidance changed again — re-check both docs before
 * undoing this, don't undo it on the strength of a checklist that doesn't
 * know this repo already made the call.
 */

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
    // 0107: never list an unlisted posting.
    .is("unlisted_at", null)
    .eq("status", "open")
    .eq("work_type", "remote")
    .gte("posted_at", floor);
  if (countError) throw new Error(countError.message);

  const { data, error } = await supabase
    .from("job_postings")
    .select(JOB_LANDING_COLUMNS)
    // 0107: never list an unlisted posting.
    .is("unlisted_at", null)
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
    // 0107: never list an unlisted posting.
    .is("unlisted_at", null)
    .eq("status", "open")
    .eq("work_type", "remote")
    .or(orFilter)
    .gte("posted_at", floor);
  if (countError) throw new Error(countError.message);

  const { data, error } = await supabase
    .from("job_postings")
    .select(JOB_LANDING_COLUMNS)
    // 0107: never list an unlisted posting.
    .is("unlisted_at", null)
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
    // 0107: never list an unlisted posting.
    .is("unlisted_at", null)
    .eq("status", "open")
    .or(orFilter)
    .gte("posted_at", floor);
  if (countError) throw new Error(countError.message);

  const { data, error } = await supabase
    .from("job_postings")
    .select(JOB_LANDING_COLUMNS)
    // 0107: never list an unlisted posting.
    .is("unlisted_at", null)
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

/**
 * "Still open" is decided at the closing INSTANT (src/lib/scholarships/close-instant.ts, migration 0204), not by comparing a date with the
 * server's UTC day: a programme that closes "13:00 Pacific" stopped being listed hours late, and one in Lagos hours early.
 */
function stillOpenFilter(): string {
  return openScholarshipFilter();
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

/**
 * send-480 — the four real rows on the signed-out /scholarships landing page ("Open this
 * cycle"): verified, still open (same filter as every loader above), nearest deadline first
 * with undated listings after every dated one.
 *
 * Only the columns a landing row renders — NOT `select("*")` like the loaders above. RLS
 * decides which ROWS are visible, but this is a separate decision about which COLUMNS reach
 * a public page: the moderation trail (`moderation_note`, `moderated_by`) has no business
 * being fetched by a surface anyone on the internet can load, even though a server component
 * would not serialise it. Same discipline as `PUBLIC_COLUMNS` in src/lib/scholarships/public.ts.
 *
 * `moderation_status = 'verified'` is filtered explicitly, and that is deliberate defence in
 * depth rather than a duplicate of RLS: the sibling loaders do the same, and
 * tests/seo/open-scholarships-preview.test.ts proves a client that BYPASSES RLS still never
 * sees a pending row through this function. NOT cached, per this file's own rule above.
 */
const LANDING_PREVIEW_COLUMNS =
  "id, provider, program_name, host_institution, degree_levels, funding_type, application_deadline, close_time, close_tz, deadline_note, official_url";

export type OpenScholarshipPreview = Pick<
  Tables<"scholarships">,
  | "id"
  | "provider"
  | "program_name"
  | "host_institution"
  | "degree_levels"
  | "funding_type"
  | "application_deadline"
  | "close_time"
  | "close_tz"
  | "deadline_note"
  | "official_url"
>;

export async function loadOpenScholarshipsPreview(
  supabase: Client,
  limit = 4,
): Promise<OpenScholarshipPreview[]> {
  const { data, error } = await supabase
    .from("scholarships")
    .select(LANDING_PREVIEW_COLUMNS)
    .eq("moderation_status", "verified")
    .or(stillOpenFilter())
    .order("application_deadline", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as OpenScholarshipPreview[];
}

/**
 * send-484 — the real rows on the signed-out /jobs landing page, and the live total that decides whether
 * they are shown at all: fresh (the 30-day floor every discovery surface enforces), open, never unlisted
 * (0107), newest first.
 *
 * ONLY THE COLUMNS A ROW RENDERS, not JOB_LANDING_COLUMNS. That wide list exists for PublicJobRow's
 * description, salary and structured fields; this page shows a title, company, place, work type, a source
 * label and an age. Measured on production: six rows of these seven columns are 1,484 B, against 14,323 B
 * with the wide list (about 9.7x), on a product whose audience skews to low-end Android on expensive data.
 * tests/seo/open-jobs-preview.test.ts pins the exact key set so a column added "just for the card" fails
 * there instead of quietly restoring the wide payload.
 *
 * ONE query returns both the rows and `total` (`count: "exact"` with a range), so they are the same
 * snapshot. `total` counts every fresh open listing, not the six returned.
 *
 * NOT cached, per this file's own rule above: a fresh query every call, and the page that calls it is
 * dynamically rendered (asserted from the response headers in e2e/jobs-tracker-public-landing.spec.ts).
 */
const JOB_PREVIEW_COLUMNS = "id, title, company_name, location, work_type, source_type, posted_at";

export type OpenJobPreview = Pick<
  Tables<"job_postings">,
  "id" | "title" | "company_name" | "location" | "work_type" | "source_type" | "posted_at"
>;

export interface OpenJobsPreviewResult {
  total: number;
  jobs: OpenJobPreview[];
}

export async function loadOpenJobsPreview(supabase: Client, limit = 6): Promise<OpenJobsPreviewResult> {
  const { data, count, error } = await supabase
    .from("job_postings")
    .select(JOB_PREVIEW_COLUMNS, { count: "exact" })
    // 0107: never list an unlisted posting.
    .is("unlisted_at", null)
    .eq("status", "open")
    .gte("posted_at", freshnessFloorISO())
    .order("posted_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return { total: count ?? 0, jobs: (data ?? []) as OpenJobPreview[] };
}
