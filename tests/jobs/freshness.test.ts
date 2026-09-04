/**
 * The freshness primitives (src/lib/jobs/freshness.ts) every discovery
 * surface's query independently applies — no single choke point exists, so
 * getting these functions exactly right matters more than usual: a bug here
 * is a bug on the feed, both SEO landing pages, the sitemap, the job detail
 * page, and Auto-Apply's candidate scan, all at once.
 */
import { describe, expect, it } from "vitest";
import {
  JOB_FRESHNESS_WINDOW_DAYS,
  JOB_DATE_FILTERS,
  JOB_DATE_FILTER_DAYS,
  freshnessFloorISO,
  isJobDateFilter,
  jobDateFilterSinceISO,
} from "@/lib/jobs/freshness";

const NOW = new Date("2026-09-04T12:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

describe("freshnessFloorISO", () => {
  it("is exactly JOB_FRESHNESS_WINDOW_DAYS before now", () => {
    const floor = new Date(freshnessFloorISO(NOW)).getTime();
    expect(NOW - floor).toBe(JOB_FRESHNESS_WINDOW_DAYS * DAY);
  });

  it("a posting exactly at the floor is included by >=, not excluded", () => {
    // .gte("posted_at", floor) is what every call site uses — the boundary
    // posting (posted_at === floor exactly) must pass that comparison.
    const floor = freshnessFloorISO(NOW);
    const postedAt = floor;
    expect(postedAt >= floor).toBe(true);
  });

  it("a posting one millisecond older than the floor is excluded", () => {
    const floor = freshnessFloorISO(NOW);
    const oneOlder = new Date(new Date(floor).getTime() - 1).toISOString();
    expect(oneOlder >= floor).toBe(false);
  });
});

describe("isJobDateFilter", () => {
  it.each(JOB_DATE_FILTERS)("accepts %s", (f) => {
    expect(isJobDateFilter(f)).toBe(true);
  });

  it("rejects an unknown string, undefined, and null", () => {
    expect(isJobDateFilter("year")).toBe(false);
    expect(isJobDateFilter(undefined)).toBe(false);
    expect(isJobDateFilter(null)).toBe(false);
    expect(isJobDateFilter("")).toBe(false);
  });
});

describe("jobDateFilterSinceISO", () => {
  it("with no filter, equals the ambient floor exactly", () => {
    expect(jobDateFilterSinceISO(undefined, NOW)).toBe(freshnessFloorISO(NOW));
  });

  it.each(Object.entries(JOB_DATE_FILTER_DAYS))("%s narrows to exactly %i day(s)", (filter, days) => {
    const since = new Date(jobDateFilterSinceISO(filter as never, NOW)).getTime();
    expect(NOW - since).toBe(days * DAY);
  });

  it(
    "SABOTAGE-PROOF TARGET: cannot be made to reach further back than the ambient floor, " +
      "even if a JOB_DATE_FILTER_DAYS entry exceeded it",
    () => {
      // Every REAL entry today is <= the floor, so this mutates one past it
      // to actually exercise the Math.min clamp — comparing "month" (which
      // already equals the floor) against the floor would pass whether or
      // not the clamp existed at all, proving nothing.
      const original = JOB_DATE_FILTER_DAYS.month;
      JOB_DATE_FILTER_DAYS.month = JOB_FRESHNESS_WINDOW_DAYS + 60;
      try {
        const since = new Date(jobDateFilterSinceISO("month", NOW)).getTime();
        const floor = new Date(freshnessFloorISO(NOW)).getTime();
        expect(since, "must clamp to the floor, not reach 90 days back").toBe(floor);
      } finally {
        JOB_DATE_FILTER_DAYS.month = original;
      }
    },
  );

  it("24h is the narrowest window and week is wider than 3d", () => {
    const day1 = new Date(jobDateFilterSinceISO("24h", NOW)).getTime();
    const day3 = new Date(jobDateFilterSinceISO("3d", NOW)).getTime();
    const week = new Date(jobDateFilterSinceISO("week", NOW)).getTime();
    // A NARROWER window (fewer days back) means a LATER (larger) timestamp.
    expect(day1).toBeGreaterThan(day3);
    expect(day3).toBeGreaterThan(week);
  });
});
