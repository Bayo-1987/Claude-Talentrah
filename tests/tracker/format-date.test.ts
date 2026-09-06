/**
 * `formatTrackerDate` is now shared across two features (the tracker card and
 * resume-builder's `ResumeListRow`), specifically because it pins an explicit
 * `"en-US"` locale to `toLocaleDateString`. That matters because the bug this
 * fix exists to prevent is a server/client hydration mismatch:
 * `toLocaleDateString()` called with NO locale argument resolves against
 * whatever locale the runtime defaults to, which can differ between Node's
 * SSR process and a browser. Passing an explicit locale removes that
 * variable entirely — this test pins the resulting fixed output so a future
 * edit that drops the explicit locale (reintroducing the mismatch) fails
 * loudly instead of only showing up as an intermittent hydration warning.
 */
import { describe, expect, it } from "vitest";
import { formatTrackerDate } from "@/lib/tracker/format-date";

describe("formatTrackerDate", () => {
  it("formats a known date in the fixed en-US, month/day/year shape", () => {
    expect(formatTrackerDate("2026-08-28T12:00:00.000Z")).toBe("Aug 28, 2026");
  });

  it("pads neither month nor day — 'short month, numeric day' regardless of date", () => {
    // Noon UTC, same as the fixture above — a midnight timestamp would land
    // on a different calendar day depending on the test runner's local
    // timezone, since this formatter (deliberately) pins locale, not zone.
    expect(formatTrackerDate("2026-01-05T12:00:00.000Z")).toBe("Jan 5, 2026");
  });
});
