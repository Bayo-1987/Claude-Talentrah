/**
 * recommendedRankingKey (src/lib/jobs/ranking.ts) — Stage 12's Recommended
 * time-decay fix. The concrete scenario reported live: a Moniepoint role
 * posted 4 weeks ago at 100% always outranked a role posted today at 75%.
 */
import { describe, expect, it } from "vitest";
import { recommendedRankingKey } from "@/lib/jobs/ranking";

const NOW = new Date("2026-09-04T12:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();
const FLOOR_DAYS = 30;

describe("recommendedRankingKey", () => {
  it(
    "SABOTAGE-PROOF TARGET: a recent good-enough match outranks a stale perfect one " +
      "(the exact live scenario — Moniepoint 100% posted 4 weeks ago vs. a fresh 75%)",
    () => {
      const staleKey = recommendedRankingKey(100, daysAgo(28), FLOOR_DAYS, NOW);
      const freshKey = recommendedRankingKey(75, daysAgo(0), FLOOR_DAYS, NOW);
      expect(freshKey).toBeGreaterThan(staleKey);
    },
  );

  it("a brand-new posting takes no penalty at all", () => {
    expect(recommendedRankingKey(80, daysAgo(0), FLOOR_DAYS, NOW)).toBe(80);
  });

  it("a fully-aged (floor-boundary) posting takes the full, bounded penalty — never more", () => {
    const key = recommendedRankingKey(100, daysAgo(FLOOR_DAYS), FLOOR_DAYS, NOW);
    expect(key).toBe(70); // 100 - 30 (RECOMMENDED_DECAY_MAX_POINTS)
  });

  it("clamps rather than over-penalising something already past the floor", () => {
    // Structurally this should never happen — the floor already excludes it
    // upstream — but the function itself must not compound a bug by
    // subtracting more than the max even if it somehow received one.
    const atFloor = recommendedRankingKey(100, daysAgo(FLOOR_DAYS), FLOOR_DAYS, NOW);
    const wayPastFloor = recommendedRankingKey(100, daysAgo(FLOOR_DAYS + 100), FLOOR_DAYS, NOW);
    expect(wayPastFloor).toBe(atFloor);
  });

  it("does not grant a bonus for a future posted_at (clock skew)", () => {
    const future = new Date(NOW + DAY).toISOString();
    expect(recommendedRankingKey(80, future, FLOOR_DAYS, NOW)).toBe(80);
  });

  it("a low fresh score still loses to a high stale one — decay narrows the gap, doesn't invert it", () => {
    const staleHigh = recommendedRankingKey(90, daysAgo(FLOOR_DAYS), FLOOR_DAYS, NOW); // 90 - 30 = 60
    const freshLow = recommendedRankingKey(50, daysAgo(0), FLOOR_DAYS, NOW); // 50
    expect(staleHigh).toBeGreaterThan(freshLow);
  });
});
