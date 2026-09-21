import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CITY_LANDING_PAGES, DEGREE_LEVEL_SLUG, LANDING_PAGE_MIN_ENTRIES } from "./landing-pages";
import { Constants, type Database, type Tables } from "@/lib/supabase/types";
import { DEGREE_LEVEL_LABEL, type DegreeLevel } from "@/lib/scholarships/types";
import { freshnessFloorISO } from "@/lib/jobs/freshness";
import { TRACKED_COUNTRIES, COUNTRY_LANDING_SLUG, deriveCountry } from "@/lib/jobs/country";

// See landing-page-data.ts's identical type for why this is generic rather
// than the request-scoped createClient()'s own return type.
type SupabaseServerClient = SupabaseClient<Database>;

export interface LandingLink {
  href: string;
  label: string;
}

/**
 * Every OTHER job landing page that is currently live, for the "explore
 * more" links on each one — live-checked the same way the page itself is,
 * so this never links to a category that would 404 if clicked. Pass the
 * current page's own href in `excludeHref` so a page never links to itself.
 *
 * ONE round trip, not eight (send-441). This used to run 1 (remote) + 4
 * (tracked countries) + 3 (curated cities) separate count(*) queries — on
 * every job landing page render AND every /jobs/[id] render, via
 * relevantJobLandingLinks below, which only ever needs one or two of them.
 * `job_landing_facet_counts` (0185) computes every facet in a single scan;
 * see that migration's own comment for why the per-facet SQL is copied from,
 * not derived from, TRACKED_COUNTRIES/SOURCE_COUNTRY_FALLBACK/
 * CITY_LANDING_PAGES, and tests/seo/landing-page-facet-rpc.test.ts for the
 * drift check that keeps the two sides honest.
 */
export async function liveJobLandingLinks(
  supabase: SupabaseServerClient,
  excludeHref?: string,
): Promise<LandingLink[]> {
  const links: LandingLink[] = [];
  // Same 30-day floor as loadRemoteJobs/loadCityJobs — a category link here
  // must agree with whether the page it points to would actually list
  // anything, and a stale-but-still-open posting would otherwise count
  // toward LANDING_PAGE_MIN_ENTRIES for a page that no longer shows it.
  const floor = freshnessFloorISO();

  const { data, error } = await supabase
    .rpc("job_landing_facet_counts", { p_floor: floor })
    .single();
  if (error) throw new Error(error.message);

  if (data.remote_count >= LANDING_PAGE_MIN_ENTRIES) {
    links.push({ href: "/jobs/remote", label: "Remote jobs" });
  }

  const countryCounts: Record<(typeof TRACKED_COUNTRIES)[number], number> = {
    Nigeria: data.nigeria_count,
    Ghana: data.ghana_count,
    Kenya: data.kenya_count,
    "South Africa": data.south_africa_count,
  };
  for (const country of TRACKED_COUNTRIES) {
    if (countryCounts[country] >= LANDING_PAGE_MIN_ENTRIES) {
      links.push({
        href: `/jobs/remote/${COUNTRY_LANDING_SLUG[country]}`,
        label: `Remote jobs in ${country}`,
      });
    }
  }

  const cityCounts: Record<string, number> = {
    lagos: data.lagos_count,
    abuja: data.abuja_count,
    nairobi: data.nairobi_count,
  };
  for (const city of CITY_LANDING_PAGES) {
    if ((cityCounts[city.slug] ?? 0) >= LANDING_PAGE_MIN_ENTRIES) {
      links.push({ href: `/jobs/in/${city.slug}`, label: `Jobs in ${city.displayName}` });
    }
  }

  return links.filter((l) => l.href !== excludeHref);
}

/** Mirrors an `%term%` ILIKE pattern against a plain string, case-insensitively. */
function matchesIlikePattern(value: string | null, pattern: string): boolean {
  if (!value) return false;
  const term = pattern.replace(/^%|%$/g, "");
  return value.toLowerCase().includes(term.toLowerCase());
}

/**
 * The subset of liveJobLandingLinks that actually applies to ONE job — for
 * the "explore more" backlink on /jobs/[id]. A job's own detail page should
 * only ever link to "Remote jobs" if IT is remote, and to "Jobs in Lagos"
 * if its own location actually says Lagos — not the full list of whatever
 * else happens to be live, which would be a link to unrelated content
 * dressed up as "related".
 */
export async function relevantJobLandingLinks(
  supabase: SupabaseServerClient,
  job: Pick<Tables<"job_postings">, "work_type" | "location" | "external_source">,
): Promise<LandingLink[]> {
  const all = await liveJobLandingLinks(supabase);
  return all.filter((link) => {
    if (link.href === "/jobs/remote") return job.work_type === "remote";
    const country = TRACKED_COUNTRIES.find(
      (c) => link.href === `/jobs/remote/${COUNTRY_LANDING_SLUG[c]}`,
    );
    if (country) return job.work_type === "remote" && deriveCountry(job) === country;
    const city = CITY_LANDING_PAGES.find((c) => link.href === `/jobs/in/${c.slug}`);
    if (city) return city.locationPatterns.some((p) => matchesIlikePattern(job.location, p));
    return false;
  });
}

/**
 * Every OTHER scholarship landing page currently live — same live-checked
 * contract as liveJobLandingLinks, and the same one-round-trip fix
 * (send-441): `scholarship_landing_facet_counts` (0185) replaces this file's
 * 1 (fully-funded) + 5 (degree level) separate count(*) queries.
 */
export async function liveScholarshipLandingLinks(
  supabase: SupabaseServerClient,
  excludeHref?: string,
): Promise<LandingLink[]> {
  const links: LandingLink[] = [];
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .rpc("scholarship_landing_facet_counts", { p_today: today })
    .single();
  if (error) throw new Error(error.message);

  if (data.fully_funded_count >= LANDING_PAGE_MIN_ENTRIES) {
    links.push({ href: "/scholarships/fully-funded", label: "Fully funded scholarships" });
  }

  const degreeLevelCounts: Record<DegreeLevel, number> = {
    bsc: data.bsc_count,
    msc: data.msc_count,
    phd: data.phd_count,
    postgraduate_diploma: data.postgraduate_diploma_count,
    other: data.other_count,
  };
  for (const level of Constants.public.Enums.scholarship_degree_level) {
    if (degreeLevelCounts[level] >= LANDING_PAGE_MIN_ENTRIES) {
      links.push({
        href: `/scholarships/degree/${DEGREE_LEVEL_SLUG[level]}`,
        label: `${DEGREE_LEVEL_LABEL[level]} scholarships`,
      });
    }
  }

  return links.filter((l) => l.href !== excludeHref);
}

/**
 * The subset of liveScholarshipLandingLinks that actually applies to ONE
 * scholarship — for the "explore more" backlink on /scholarships/[id]. Same
 * reasoning as relevantJobLandingLinks: only link to a category this
 * specific listing genuinely belongs to.
 */
export async function relevantScholarshipLandingLinks(
  supabase: SupabaseServerClient,
  scholarship: Pick<Tables<"scholarships">, "funding_type" | "degree_levels">,
): Promise<LandingLink[]> {
  const all = await liveScholarshipLandingLinks(supabase);
  return all.filter((link) => {
    if (link.href === "/scholarships/fully-funded") return scholarship.funding_type === "full";
    const level = Constants.public.Enums.scholarship_degree_level.find(
      (l) => link.href === `/scholarships/degree/${DEGREE_LEVEL_SLUG[l]}`,
    );
    if (level) return scholarship.degree_levels.includes(level);
    return false;
  });
}
