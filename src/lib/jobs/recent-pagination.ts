import type { Tables } from "@/lib/supabase/types";
import { deriveCountry, COUNTRY_THIN_THRESHOLD, type TrackedCountry } from "./country";

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
