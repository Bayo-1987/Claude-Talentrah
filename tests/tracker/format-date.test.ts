/**
 * `formatTrackerDate` is shared across two features (the tracker card and resume-builder's `ResumeListRow`).
 *
 * It exists to prevent a server/client hydration mismatch: `toLocaleDateString()` with NO locale resolves against whatever
 * the runtime defaults to, which differs between Node's SSR process and a browser. send-499 moved the whole app onto one
 * formatter (src/lib/format/datetime.ts), which spells the month names itself and takes an explicit zone, so the mismatch
 * is impossible by construction rather than by a pinned locale. This test pins the resulting output, in the app's house
 * format ("10 Sep 2026", not the US "Sep 10, 2026" this used to print, which read as a different date to a Nigerian
 * reader), so a drift fails loudly.
 */
import { describe, expect, it } from "vitest";
import { formatTrackerDate } from "@/lib/tracker/format-date";

describe("formatTrackerDate", () => {
  it("formats a known date in the house shape: day, short month, year", () => {
    expect(formatTrackerDate("2026-08-28T12:00:00.000Z")).toBe("28 Aug 2026");
  });

  it("pads neither the day nor anything else, and is never the US month-first shape", () => {
    // Noon UTC is the same calendar day in WAT (the default zone) and UTC.
    expect(formatTrackerDate("2026-01-05T12:00:00.000Z")).toBe("5 Jan 2026");
    expect(formatTrackerDate("2026-08-28T12:00:00.000Z")).not.toMatch(/,/);
  });
});
