/**
 * displayMatchScore (src/lib/match-tier.ts) — Stage 12's "stop displaying
 * 100%" fix. Display-only: never touches getMatchTier's tier boundaries, and
 * never changes a score that wasn't already at the ceiling.
 */
import { describe, expect, it } from "vitest";
import {
  displayMatchScore,
  getMatchTier,
  getDisplayMatchTier,
  isThinScreenableTagSet,
  THIN_SCREENABLE_TAG_MAX,
  hasNoScreenableSkills,
  screenedFirstCompare,
} from "@/lib/match-tier";

describe("getMatchTier", () => {
  it("has no floor — anything under 70 is fair, including well under 60", () => {
    // Pinned deliberately: this is the STORAGE-facing function
    // (compute-and-store.ts writes its result straight into
    // match_scores.tier, a `not null` column) and digest/select.ts's own
    // caller pre-filters to score >= 70 before ever reaching it — neither
    // has a reason to see a floor, and this test exists so a future "add
    // the floor here too" edit gets caught rather than silently breaking a
    // NOT NULL write. getDisplayMatchTier (below) is where the floor lives.
    expect(getMatchTier(59)).toBe("fair");
    expect(getMatchTier(0)).toBe("fair");
  });

  it("the 60/70/80 boundaries", () => {
    expect(getMatchTier(69)).toBe("fair");
    expect(getMatchTier(70)).toBe("good");
    expect(getMatchTier(79)).toBe("good");
    expect(getMatchTier(80)).toBe("excellent");
  });
});

describe("getDisplayMatchTier", () => {
  it("SABOTAGE-PROOF TARGET: a 50% score is not Fair — it has no tier at all", () => {
    expect(getDisplayMatchTier(50)).toBeNull();
  });

  it("null for anything under 60", () => {
    expect(getDisplayMatchTier(59)).toBeNull();
    expect(getDisplayMatchTier(0)).toBeNull();
  });

  it("the 60/70/80 boundaries still hold once there's a floor", () => {
    expect(getDisplayMatchTier(60)).toBe("fair");
    expect(getDisplayMatchTier(69)).toBe("fair");
    expect(getDisplayMatchTier(70)).toBe("good");
    expect(getDisplayMatchTier(79)).toBe("good");
    expect(getDisplayMatchTier(80)).toBe("excellent");
    expect(getDisplayMatchTier(100)).toBe("excellent");
  });
});

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

describe("isThinScreenableTagSet", () => {
  it(
    "SABOTAGE-PROOF TARGET: the One Acre Fund / ALX Africa case — exactly 1 screenable tag is thin",
    () => {
      expect(isThinScreenableTagSet(1)).toBe(true);
    },
  );

  it("0 tags is thin too (a bare percentage carries even less evidence)", () => {
    expect(isThinScreenableTagSet(0)).toBe(true);
  });

  it("shares its cutoff with match-breakdown.tsx's own 'thin' sub-score line", () => {
    expect(isThinScreenableTagSet(THIN_SCREENABLE_TAG_MAX)).toBe(true);
    expect(isThinScreenableTagSet(THIN_SCREENABLE_TAG_MAX + 1)).toBe(false);
  });

  it("a genuinely thick skill set is not thin", () => {
    expect(isThinScreenableTagSet(6)).toBe(false);
  });
});

describe("hasNoScreenableSkills", () => {
  it("SABOTAGE-PROOF TARGET: exactly zero tags is unscreened", () => {
    expect(hasNoScreenableSkills(0)).toBe(true);
  });

  it("one tag is thin (isThinScreenableTagSet), but NOT unscreened — the two predicates diverge at 1", () => {
    expect(hasNoScreenableSkills(1)).toBe(false);
    expect(isThinScreenableTagSet(1)).toBe(true);
  });

  it("a thick skill set is not unscreened", () => {
    expect(hasNoScreenableSkills(12)).toBe(false);
  });
});

describe("screenedFirstCompare", () => {
  it("SABOTAGE-PROOF TARGET: an unscreened posting sorts after a screened one, regardless of the base comparison", () => {
    // Base comparison says the unscreened one (a) should win by a landslide
    // (a large negative number) — the partition must override that.
    expect(screenedFirstCompare(true, false, -1000)).toBeGreaterThan(0);
    expect(screenedFirstCompare(false, true, 1000)).toBeLessThan(0);
  });

  it("when both sides agree on screened/unscreened, the base comparison decides, untouched", () => {
    expect(screenedFirstCompare(false, false, -7)).toBe(-7);
    expect(screenedFirstCompare(true, true, 42)).toBe(42);
    expect(screenedFirstCompare(false, false, 0)).toBe(0);
  });

  it("reproduces the real production inversion this exists to fix: a 55% unscreened posting no longer beats a 25% measured one", () => {
    // Offline Customer Support Officer (0 tags, score 55) vs Senior Developer
    // (12 tags, score 25) — docs/zero-skill-scoring.md's own live example.
    const baseComparison = 25 - 55; // plain "higher score wins" comparator, negative = unscreened wins
    expect(screenedFirstCompare(true, false, baseComparison)).toBeGreaterThan(0); // now the measured one wins
  });
});
