/**
 * displayMatchScore (src/lib/match-tier.ts) — Stage 12's "stop displaying
 * 100%" fix. Display-only: never touches getMatchTier's tier boundaries, and
 * never changes a score that wasn't already at the ceiling.
 */
import { describe, expect, it } from "vitest";
import { displayMatchScore, getMatchTier } from "@/lib/match-tier";

describe("displayMatchScore", () => {
  it(
    "SABOTAGE-PROOF TARGET: never renders a literal 100",
    () => {
      expect(displayMatchScore(100)).toBeLessThan(100);
    },
  );

  it("does not touch a score that was never at the ceiling", () => {
    expect(displayMatchScore(92)).toBe(92);
    expect(displayMatchScore(70)).toBe(70);
    expect(displayMatchScore(0)).toBe(0);
  });

  it("is a no-op immediately below the cap", () => {
    expect(displayMatchScore(99)).toBe(99);
  });

  it("clamps anything at or above 99, not just exactly 100", () => {
    expect(displayMatchScore(105)).toBe(99);
  });

  it("never changes which tier a score belongs to — display-only", () => {
    // getMatchTier is called on the REAL score, never on the capped display
    // value — the two are independent functions of the same input, and the
    // tier a 100% match belongs to must stay "excellent" regardless of what
    // number is printed next to it.
    expect(getMatchTier(100)).toBe("excellent");
  });
});
