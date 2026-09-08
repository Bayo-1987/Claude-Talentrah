import type { Tables } from "@/lib/supabase/types";
import { deriveCountry, countryOrFilter, COUNTRY_THIN_THRESHOLD, type TrackedCountry } from "./country";

/**
 * The Recent tab's own lightweight board-wide read (jobs/page.tsx's
 * `boardAggregateQuery`) — enough to run `deriveCountry` and the
 * search-suggestion index, nothing FEED_COLUMNS carries for rendering a card.
 */
export type BoardAggregateRow = Pick<
  Tables<"job_postings">,
  "title" | "company_name" | "location" | "external_source" | "work_type" | "structured_jd"
>;

/** Page size for the Recent tab's DB-side pagination. No stated requirement from product — picked as a reasonable default; revisit with real usage data. */
export const RECENT_PAGE_SIZE = 24;

/**
 * Whether the Recent tab's country filter should be pushed into the DB
 * query, and the honest count behind that decision.
 *
 * WHY THIS HAS TO RUN BEFORE THE PAGE QUERY IS BUILT, NOT AFTER: every other
 * tab applies the country filter as a plain in-memory `.filter()` on the
 * (previously always-complete) fetched board — see jobs/page.tsx's own
 * countryFallbackNotice block. That is safe only when the whole board is in
 * memory. Once the Recent tab's own fetch is DB-side `.range()`-paginated, an
 * in-memory country filter applied AFTER that range would silently corrupt
 * pagination: page 2 would continue the UNFILTERED board's next slice, not
 * the next page of country matches, so "Next" could skip matches entirely or
 * repeat ones already shown depending on how they happen to interleave with
 * non-matching rows in DB order. Deciding first and pushing a real `.or()`
 * filter (countryOrFilter, already used for the public landing pages'
 * equivalent DB-side count) is the only way pagination and the country
 * filter can coexist correctly.
 *
 * Mirrors the existing COUNTRY_THIN_THRESHOLD fallback rule exactly: below
 * threshold, the country filter is not applied at all (the fallback shows
 * the unfiltered board with a notice) rather than applied to noticeably empty.
 */
/**
 * The Recent tab's own country `.or()` clause — NOT `countryOrFilter` alone.
 *
 * WHY THIS CANNOT REUSE countryOrFilter AS-IS. Every other caller of
 * `countryOrFilter` (sitemap.ts, landing-page-links.ts,
 * loadCountryRemoteJobs) is already scoped to `work_type = 'remote'` by an
 * unconditional `.eq()` elsewhere in the SAME query — confirmed by reading
 * all three before writing this, not assumed. For them, `countryOrFilter`
 * only has to narrow an already-remote set by country name, so it never
 * needs its own remote clause.
 *
 * The Recent tab is NOT remote-scoped — it spans every work type — and the
 * product's own "country OR remote" rule (jobs/page.tsx's in-memory filter,
 * and `decideCountryFilter`'s own threshold count above) treats ANY remote
 * posting as matching ANY tracked country, regardless of its location text.
 * `countryOrFilter` alone has no way to express that: it only matches a
 * literal country name in `location` or a single-country source fallback.
 * Pushing it down without a remote branch would silently drop every remote
 * posting whose location doesn't literally name the country — a bare
 * "Remote", "Remote, Spain", "Remote, Bangalore" are all real, live rows on
 * production today — from Recent's paginated results, while
 * `decideCountryFilter`'s own count (which DOES include them) still decided
 * to turn the filter on, and every OTHER tab still shows them via the
 * untouched in-memory filter. Exactly the class of coupling bug this file's
 * other functions exist to prevent — just missed on this one branch.
 *
 * SAFE alongside an active work-type filter. `.or()` ANDs with everything
 * else already on the query (postingsQuery's own header makes the same
 * point about its unlisted-org `.or()`), so if `workTypes` has already
 * narrowed the query to, say, `['onsite']` via `.in()`, this clause's
 * `work_type.eq.remote` branch can never match a row already excluded by
 * that `.in()` — it degrades to a no-op the same way the in-memory version
 * does once `jobs` no longer contains any remote row.
 *
 * MUST NOT be folded into `countryOrFilter` itself: that would break its
 * OTHER three callers, which are already `work_type = 'remote'`-scoped —
 * an unconditional "OR remote" there would make their own country narrowing
 * a no-op, since every row they see already satisfies `work_type = 'remote'`.
 */
export function recentCountryOrFilter(country: TrackedCountry): string {
  return `${countryOrFilter(country)},work_type.eq.remote`;
}

export function decideCountryFilter(
  boardRows: Pick<Tables<"job_postings">, "location" | "external_source" | "work_type">[],
  country: TrackedCountry | undefined,
): { apply: boolean; matched: number } {
  if (!country) return { apply: false, matched: 0 };
  const matched = boardRows.filter(
    (j) => deriveCountry(j) === country || j.work_type === "remote",
  ).length;
  return { apply: matched >= COUNTRY_THIN_THRESHOLD, matched };
}
