import { describe, expect, it } from "vitest";
import { formatInterviewTime, formatInterviewRange } from "@/lib/interviews/format";

describe("formatInterviewTime: UTC stored, shown in the viewer's own zone", () => {
  it("Lagos is UTC+1 all year", () => {
    expect(formatInterviewTime("2026-10-24T09:00:00Z", "Africa/Lagos")).toContain("10:00");
    expect(formatInterviewTime("2026-10-26T09:00:00Z", "Africa/Lagos")).toContain("10:00");
    expect(formatInterviewTime("2026-07-01T09:00:00Z", "Africa/Lagos")).toContain("10:00");
  });

  it("London BEFORE the clocks go back on Sunday 25 Oct 2026 is BST (UTC+1): 09:00Z reads 10:00", () => {
    const text = formatInterviewTime("2026-10-24T09:00:00Z", "Europe/London");
    expect(text).toContain("10:00");
    expect(text).toContain("BST");
  });

  it("London AFTER the clocks go back is GMT (UTC+0): 09:00Z reads 09:00, so Lagos and London differ by one hour only after 25 Oct", () => {
    const text = formatInterviewTime("2026-10-26T09:00:00Z", "Europe/London");
    expect(text).toContain("09:00");
    expect(text).toContain("GMT");
  });

  it("the same instant reads differently in different zones and the date follows the zone (late evening UTC is the next day in Lagos)", () => {
    expect(formatInterviewTime("2026-10-26T23:30:00Z", "Africa/Lagos")).toContain("27 Oct");
    expect(formatInterviewTime("2026-10-26T23:30:00Z", "Europe/London")).toContain("26 Oct");
  });

  it("the clock change itself: 00:30Z and 01:30Z on 25 Oct are 01:30 BST and 01:30 GMT in London (the hour repeats)", () => {
    expect(formatInterviewTime("2026-10-25T00:30:00Z", "Europe/London")).toMatch(/01:30.*BST/);
    expect(formatInterviewTime("2026-10-25T01:30:00Z", "Europe/London")).toMatch(/01:30.*GMT/);
  });

  it("an unknown or empty zone falls back to UTC instead of throwing", () => {
    expect(formatInterviewTime("2026-10-26T09:00:00Z", "Not/AZone")).toContain("09:00");
    expect(formatInterviewTime("2026-10-26T09:00:00Z", "")).toContain("09:00");
  });

  it("a range shows the start and the end in the same zone", () => {
    expect(formatInterviewRange("2026-10-26T09:00:00Z", 45, "Africa/Lagos")).toMatch(/10:00.*10:45/);
    expect(formatInterviewRange("2026-10-26T09:30:00Z", 60, "Europe/London")).toMatch(/09:30.*10:30/);
  });
});
