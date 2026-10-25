import type { TrackedCountry } from "@/lib/jobs/country";
import type { JobDateFilter } from "@/lib/jobs/freshness";

/**
 * The feed tabs' own links. A country the person chose travels with them (including to Saved, which does not apply it, so the choice is still there on the way back);
 * with none chosen the link names none, which means every country.
 */
export function feedTabHref(tab: string, country: TrackedCountry | undefined): string {
  const sp = new URLSearchParams({ tab });
  if (country) sp.set("country", country);
  return `/jobs?${sp.toString()}`;
}

/**
 * Most Recent's Prev/Next links: every active filter, `page` only when it is not 1 (mirrors scholarships/page.tsx's buildPageHref). `q` is deliberately never carried:
 * paging only exists on Most Recent with no search term. The country is written only when the person chose one; never `country=all`.
 */
export function recentPageHref(args: {
  workTypes: string[];
  seniorities: string[];
  posted?: JobDateFilter;
  country: TrackedCountry | undefined;
  target: number;
}): string {
  const sp = new URLSearchParams();
  sp.set("tab", "recent");
  if (args.workTypes.length) sp.set("workType", args.workTypes.join(","));
  if (args.seniorities.length) sp.set("seniority", args.seniorities.join(","));
  if (args.posted) sp.set("posted", args.posted);
  if (args.country) sp.set("country", args.country);
  if (args.target > 1) sp.set("page", String(args.target));
  return `/jobs?${sp.toString()}`;
}
