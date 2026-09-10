/**
 * send-140's own pure period logic — no database, matching this repo's
 * standing convention for decision logic (getJobShareVisibility, digest's
 * selectDigestJobs).
 */
import { describe, expect, it } from "vitest";
import { LEADERBOARD_GRACE_DAYS, isWithinRolloverGrace, monthRange } from "@/lib/referrals/leaderboard";

describe("monthRange", () => {
  it("returns the current calendar month as [start, end) in UTC", () => {
    const now = new Date("2026-09-15T18:30:00.000Z");
    const { start, end } = monthRange(now);
    expect(start).toBe("2026-09-01T00:00:00.000Z");
    expect(end).toBe("2026-10-01T00:00:00.000Z");
  });

  it("returns the PREVIOUS calendar month when monthsAgo=1", () => {
    const now = new Date("2026-09-15T18:30:00.000Z");
    const { start, end } = monthRange(now, 1);
    expect(start).toBe("2026-08-01T00:00:00.000Z");
    expect(end).toBe("2026-09-01T00:00:00.000Z");
  });

  it("correctly rolls back across a year boundary", () => {
    const now = new Date("2026-01-10T00:00:00.000Z");
    const { start, end } = monthRange(now, 1);
    expect(start).toBe("2025-12-01T00:00:00.000Z");
    expect(end).toBe("2026-01-01T00:00:00.000Z");
  });

  it("is stable at the very start of a month — the first instant is IN this month, not the previous one", () => {
    const now = new Date("2026-09-01T00:00:00.001Z");
    const { start } = monthRange(now);
    expect(start).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("isWithinRolloverGrace", () => {
  it(`is true for day 1 through day ${LEADERBOARD_GRACE_DAYS} of the month`, () => {
    for (let day = 1; day <= LEADERBOARD_GRACE_DAYS; day++) {
      const now = new Date(Date.UTC(2026, 8, day, 12, 0, 0));
      expect(isWithinRolloverGrace(now), `day ${day} should be within grace`).toBe(true);
    }
  });

  it(`is false the day right after the grace window ends`, () => {
    const now = new Date(Date.UTC(2026, 8, LEADERBOARD_GRACE_DAYS + 1, 0, 0, 0));
    expect(isWithinRolloverGrace(now)).toBe(false);
  });

  it("is false for an ordinary mid-month day", () => {
    const now = new Date("2026-09-15T00:00:00.000Z");
    expect(isWithinRolloverGrace(now)).toBe(false);
  });

  it("is true again at the very start of the NEXT month, not stuck off", () => {
    const now = new Date(Date.UTC(2026, 9, 1, 0, 0, 0));
    expect(isWithinRolloverGrace(now)).toBe(true);
  });
});
