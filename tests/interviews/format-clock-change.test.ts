/**
 * The UK clock change on the candidate's interview page, with FIXED dates and explicit zones, no database, no clock (moved here from e2e/schedule-interview.spec.ts).
 *
 * That e2e test offered times on 24 and 26 Oct 2026 and read the real candidate page in Lagos and London: BST before Sunday 25 Oct 2026, GMT after. It could only do that while those dates were inside the
 * 60-day window create_interview_offer accepts, so it went red on 20 Oct 2026 (and no window straddling a UK clock change exists again until about late January 2027). The page's text is
 * `formatInterviewRange(startsAt, durationMinutes, zone)` (src/components/interviews/local-time.tsx, with the browser's zone), so the four exact strings the e2e test asserted are asserted here on that function,
 * plus the same instants either side of the change the e2e test could not reach. What stays in the e2e spec, every day: that the real page shows each offered time in the browser's own zone (computed from the clock).
 */
import { describe, expect, it } from "vitest";
import { formatInterviewRange } from "@/lib/interviews/format";

describe("the same stored times, either side of the UK clock change (Sunday 25 Oct 2026)", () => {
  const before = "2026-10-24T09:00:00Z"; // BST in London
  const after = "2026-10-26T09:00:00Z"; // GMT in London

  it("Lagos reads 10:00 on both days (UTC+1 all year, WAT)", () => {
    expect(formatInterviewRange(before, 45, "Africa/Lagos")).toBe("Sat 24 Oct at 10:00 to 10:45 WAT");
    expect(formatInterviewRange(after, 45, "Africa/Lagos")).toBe("Mon 26 Oct at 10:00 to 10:45 WAT");
  });

  it("London reads 10:00 BST before the change and 09:00 GMT after it: the same stored time", () => {
    expect(formatInterviewRange(before, 45, "Europe/London")).toBe("Sat 24 Oct at 10:00 to 10:45 BST");
    expect(formatInterviewRange(after, 45, "Europe/London")).toBe("Mon 26 Oct at 09:00 to 09:45 GMT");
  });

  it("so Lagos and London differ by an hour only after the change", () => {
    const hour = (iso: string, zone: string) => formatInterviewRange(iso, 45, zone).match(/at (\d{2}):/)![1];
    expect(hour(before, "Africa/Lagos")).toBe(hour(before, "Europe/London"));
    expect(Number(hour(after, "Africa/Lagos")) - Number(hour(after, "Europe/London"))).toBe(1);
  });

  it("the change itself: 00:30Z on 25 Oct is 01:30 BST, and 01:30Z the same day is 01:30 GMT (the hour repeats)", () => {
    expect(formatInterviewRange("2026-10-25T00:30:00Z", 15, "Europe/London")).toBe("Sun 25 Oct at 01:30 to 01:45 BST");
    expect(formatInterviewRange("2026-10-25T01:30:00Z", 45, "Europe/London")).toBe("Sun 25 Oct at 01:30 to 02:15 GMT");
  });
});
