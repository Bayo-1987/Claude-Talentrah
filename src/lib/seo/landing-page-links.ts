import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CITY_LANDING_PAGES, DEGREE_LEVEL_SLUG, LANDING_PAGE_MIN_ENTRIES } from "./landing-pages";
import { Constants, type Database, type Tables } from "@/lib/supabase/types";
import { DEGREE_LEVEL_LABEL } from "@/lib/scholarships/types";
import { freshnessFloorISO } from "@/lib/jobs/freshness";

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

  const { count: remoteCount } = await supabase
    .from("job_postings")
    .select("id", { count: "exact", head: true })
    .eq("status", "open")
    .eq("work_type", "remote")
    .gte("posted_at", floor);
  if ((remoteCount ?? 0) >= LANDING_PAGE_MIN_ENTRIES) {
    links.push({ href: "/jobs/remote", label: "Remote jobs" });
  }

  for (const city of CITY_LANDING_PAGES) {
    let query = supabase.from("job_postings").select("id", { count: "exact", head: true }).eq("status", "open");
    query = query.or(city.locationPatterns.map((p) => `location.ilike.${p}`).join(","));
    query = query.gte("posted_at", floor);
    const { count } = await query;
    if ((count ?? 0) >= LANDING_PAGE_MIN_ENTRIES) {
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
  job: Pick<Tables<"job_postings">, "work_type" | "location">,
): Promise<LandingLink[]> {
  const all = await liveJobLandingLinks(supabase);
  return all.filter((link) => {
    if (link.href === "/jobs/remote") return job.work_type === "remote";
    const city = CITY_LANDING_PAGES.find((c) => link.href === `/jobs/in/${c.slug}`);
    if (city) return city.locationPatterns.some((p) => matchesIlikePattern(job.location, p));
    return false;
  });
}

/**
 * Every OTHER scholarship landing page currently live — same live-checked
 * contract as liveJobLandingLinks.
 */
export async function liveScholarshipLandingLinks(
  supabase: SupabaseServerClient,
  excludeHref?: string,
): Promise<LandingLink[]> {
  const links: LandingLink[] = [];
  const today = new Date().toISOString().slice(0, 10);

  const { count: fullyFundedCount } = await supabase
    .from("scholarships")
    .select("id", { count: "exact", head: true })
    .eq("moderation_status", "verified")
    .eq("funding_type", "full")
    .or(`application_deadline.is.null,application_deadline.gte.${today}`);
  if ((fullyFundedCount ?? 0) >= LANDING_PAGE_MIN_ENTRIES) {
    links.push({ href: "/scholarships/fully-funded", label: "Fully funded scholarships" });
  }

  for (const level of Constants.public.Enums.scholarship_degree_level) {
    const { count } = await supabase
      .from("scholarships")
      .select("id", { count: "exact", head: true })
      .eq("moderation_status", "verified")
      .contains("degree_levels", [level])
      .or(`application_deadline.is.null,application_deadline.gte.${today}`);
    if ((count ?? 0) >= LANDING_PAGE_MIN_ENTRIES) {
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
