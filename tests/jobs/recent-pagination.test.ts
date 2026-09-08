/**
 * The Recent tab's DB-side pagination needs the country filter decided
 * BEFORE the paginated query is built (see recent-pagination.ts's own
 * header for why an in-memory country filter after a DB `.range()` silently
 * corrupts pagination). This is the one piece of that fix with real
 * conditional logic worth a standalone, DB-free test.
 */
import { describe, expect, it } from "vitest";
import { decideCountryFilter, recentCountryOrFilter } from "@/lib/jobs/recent-pagination";
import { COUNTRY_THIN_THRESHOLD, countryOrFilter } from "@/lib/jobs/country";
import type { Constants } from "@/lib/supabase/types";

type WorkType = (typeof Constants.public.Enums.work_type)[number];

function row(overrides: Partial<{ location: string | null; external_source: string | null; work_type: WorkType | null }> = {}) {
  return { location: null, external_source: null, work_type: null, ...overrides };
}

describe("decideCountryFilter", () => {
  it("never applies when no country is selected, regardless of board contents", () => {
    const rows = Array.from({ length: 20 }, () => row({ location: "Lagos, Nigeria" }));
    expect(decideCountryFilter(rows, undefined)).toEqual({ apply: false, matched: 0 });
  });

  it("applies once real matches clear the thin threshold", () => {
    const rows = Array.from({ length: COUNTRY_THIN_THRESHOLD + 1 }, () =>
      row({ location: "Lagos, Nigeria" }),
    );
    const result = decideCountryFilter(rows, "Nigeria");
    expect(result).toEqual({ apply: true, matched: COUNTRY_THIN_THRESHOLD + 1 });
  });

  it("does NOT apply below the thin threshold, but still reports the honest matched count", () => {
    const rows = [row({ location: "Lagos, Nigeria" }), row({ location: "Nairobi, Kenya" })];
    const result = decideCountryFilter(rows, "Nigeria");
    expect(result.apply).toBe(false);
    expect(result.matched).toBe(1);
  });

  it("counts a remote posting toward every country, matching the feed's own country-OR-remote rule", () => {
    const rows = Array.from({ length: COUNTRY_THIN_THRESHOLD }, () => row({ work_type: "remote" }));
    const result = decideCountryFilter(rows, "Ghana");
    expect(result).toEqual({ apply: true, matched: COUNTRY_THIN_THRESHOLD });
  });

  it("exactly at the threshold applies (>=, not >)", () => {
    const rows = Array.from({ length: COUNTRY_THIN_THRESHOLD }, () => row({ location: "Accra, Ghana" }));
    const result = decideCountryFilter(rows, "Ghana");
    expect(result.apply).toBe(true);
  });
});

/**
 * The bug this exists to pin: `decideCountryFilter` above counts a remote
 * posting as matching ANY country regardless of its location text — but
 * `countryOrFilter` (shared with the public landing pages, which are all
 * already work_type='remote'-scoped) has no way to express "or remote" on
 * its own. Pushing `countryOrFilter` bare into the Recent tab's query
 * — which is NOT remote-scoped — would silently drop a real, live class of
 * row: a remote posting whose location doesn't literally name the tracked
 * country (a bare "Remote", "Remote, Spain", "Remote, Bangalore" — all
 * present on production today) from Recent's paginated results, while
 * `decideCountryFilter`'s own count still decided to turn the filter on.
 */
describe("recentCountryOrFilter", () => {
  it("includes a work_type.eq.remote branch that plain countryOrFilter does not have", () => {
    const clause = recentCountryOrFilter("Nigeria");
    expect(clause).toContain("work_type.eq.remote");
    // Confirms the premise: the shared function really doesn't carry this on
    // its own, which is why this wrapper has to exist at all.
    expect(countryOrFilter("Nigeria")).not.toContain("work_type.eq.remote");
  });

  it("still carries the country-specific clause countryOrFilter itself produces", () => {
    const clause = recentCountryOrFilter("Ghana");
    expect(clause).toContain(countryOrFilter("Ghana"));
  });

  it("produces a single comma-joined .or() string with the remote branch last", () => {
    // Exact shape, not just substring containment — a caller passing this
    // straight to Supabase's .or() needs one string, not an array.
    expect(recentCountryOrFilter("Kenya")).toBe(`${countryOrFilter("Kenya")},work_type.eq.remote`);
  });
});
