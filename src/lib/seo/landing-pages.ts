import type { DegreeLevel } from "@/lib/scholarships/types";

/**
 * Shared rules for the programmatic SEO landing pages (jobs-by-city,
 * jobs-remote, scholarships-by-funding-type, scholarships-by-degree-level).
 *
 * ── THE THRESHOLD, AND WHY IT IS LIVE ─────────────────────────────────────
 *
 * A category page with a handful of results or none is doorway spam — it
 * exists to rank for a phrase, not to answer the person who searched it, and
 * search engines increasingly treat a domain that serves those as lower
 * quality across the board, not just on the thin page itself. So every
 * landing page in this feature re-runs its own live count query on every
 * request (`export const dynamic = "force-dynamic"`, matching sitemap.ts's
 * own reasoning) and 404s below the line — never a build-time decision,
 * because job postings close continuously and scholarships expire on a
 * schedule (see src/lib/jobs/expiry.ts and the scholarship recheck pipeline).
 * A category that empties out below 5 must drop out on its own, the same run
 * it happens, with no deploy and no one needing to remember to remove a page.
 */
export const LANDING_PAGE_MIN_ENTRIES = 5;

/**
 * The academic-cycle year pair scholarship search queries actually carry
 * ("DAAD Scholarship 2026/2027", "fully funded scholarships 2026/2027 for
 * Nigerian students") — computed from the current date, never hardcoded, so
 * this advances on its own every cycle with no annual edit.
 *
 * Scholarship application windows for the cycle beginning in a given
 * September cluster from around July of the same calendar year through the
 * following spring (Chevening, Commonwealth, DAAD, Mastercard Foundation
 * all open in this window per the live catalog). From July onward, a seeker
 * searching is looking for the cycle starting THIS September — hence the
 * July cutoff below. Before July, the cycle beginning last September is
 * generally still the one with deadlines ahead, so the pair stays one year
 * back until the next July rolls the window forward.
 */
export function currentApplicationCycle(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const JULY = 6; // getUTCMonth() is 0-indexed
  const startYear = now.getUTCMonth() >= JULY ? year : year - 1;
  return `${startYear}/${startYear + 1}`;
}

/**
 * Curated job-city landing pages — deliberately NOT a dynamic segment
 * matching arbitrary text. `job_postings.location` is free text (see
 * src/lib/jobs/dedup.ts's canonicalLocationToken for how inconsistently
 * sources state it), so there is no reliable way to discover "which cities
 * are real" from the column alone without either a curated gazetteer
 * (rejected here for the same reason job-posting-jsonld.ts's
 * parseJobLocation rejects one — a hand-maintained place-name list goes
 * stale silently) or accepting arbitrary crawler-supplied path segments as
 * search queries, which is exactly the doorway-spam shape this feature
 * exists to avoid.
 *
 * So: a short, explicit, reviewed list. Adding a city is a deliberate
 * decision — check the live count first (see docs on LANDING_PAGE_MIN_ENTRIES
 * above) — not an automatic inference. Measured against production
 * 2026-09-02, open postings only: Lagos 32, Abuja/FCT 3, Nairobi 3, Kano 3,
 * Port Harcourt 0 — only Lagos currently clears the threshold, which is why
 * it is the only entry. The LIVE check still runs on every request even
 * for this curated list — a city can be listed here and still 404 if its
 * count drops, exactly like every other landing page in this feature.
 */
export interface CityLandingPage {
  slug: string;
  displayName: string;
  /** ILIKE pattern(s) matched against job_postings.location. */
  locationPatterns: string[];
}

export const CITY_LANDING_PAGES: CityLandingPage[] = [
  { slug: "lagos", displayName: "Lagos", locationPatterns: ["%lagos%"] },
];

export function findCityLandingPage(slug: string): CityLandingPage | undefined {
  return CITY_LANDING_PAGES.find((c) => c.slug === slug);
}

/**
 * URL slugs for /scholarships/degree/[level] — hyphenated rather than the
 * enum's own snake_case, because a hyphen is what Google reliably treats as
 * a word boundary in a URL and an underscore is not. Covers all five
 * `scholarship_degree_level` enum values, not just the ones currently above
 * threshold — a level that is thin today (bsc, postgraduate_diploma, other
 * are all under 5 in production as of 2026-09-02) still gets a route that
 * simply 404s until it clears the bar, rather than needing new code the day
 * it does. Reusing DEGREE_LEVEL_LABEL from scholarships/types.ts for display
 * rather than inventing a second name for the same concept.
 */
export const DEGREE_LEVEL_SLUG: Record<DegreeLevel, string> = {
  bsc: "bsc",
  msc: "msc",
  phd: "phd",
  postgraduate_diploma: "postgraduate-diploma",
  other: "other",
};

export function degreeLevelFromSlug(slug: string): DegreeLevel | undefined {
  const entry = Object.entries(DEGREE_LEVEL_SLUG).find(([, s]) => s === slug);
  return entry?.[0] as DegreeLevel | undefined;
}
