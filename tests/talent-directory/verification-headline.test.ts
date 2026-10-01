/**
 * send-495 / S19 — what /talent-directory/verify says about a score, by band.
 *
 * A 70/100 sat under the line "your resume holds up — complete, specific, and internally consistent" while the
 * feedback beneath it said the resume lacked key details. The grader has ONE threshold (70, pass or fail), so the
 * page had one sentence for every score. Copy only: the pass mark does not move.
 *
 * Owner-specified bands (2026-10-01), edges tested at 69, 70, 84 and 85:
 *   under 70  -> "Not verified yet — here's what to fix"
 *   70 to 84  -> "Verified — a few things to tighten"
 *   85 and up -> "Verified — your resume holds up"
 *
 * Reached through loadModule so the file compiles before the module exists.
 */
import { describe, expect, it } from "vitest";
import { VERIFICATION_PASS_THRESHOLD } from "@/lib/talent-directory/verification";
import { loadModule } from "../support/load-module";

interface Mod {
  verificationHeadline?: (status: string, score: number | null) => string;
  VERIFICATION_BAND_PASS?: number;
}

async function headline(status: string, score: number | null): Promise<string> {
  const mod = await loadModule<Mod>("@/lib/talent-directory/verification-copy");
  expect(mod.verificationHeadline, "verificationHeadline must be exported from verification-copy.ts").toBeTypeOf("function");
  return mod.verificationHeadline!(status, score);
}

const NOT_YET = "Not verified yet — here's what to fix";
const TIGHTEN = "Verified — a few things to tighten";
const HOLDS_UP = "Verified — your resume holds up";

describe("a graded attempt, by score band", () => {
  for (const [status, score, expected] of [
    ["rejected", 0, NOT_YET],
    ["rejected", 69, NOT_YET],
    ["verified", 70, TIGHTEN],
    ["verified", 77, TIGHTEN],
    ["verified", 84, TIGHTEN],
    ["verified", 85, HOLDS_UP],
    ["verified", 100, HOLDS_UP],
  ] as const) {
    it(`${status} at ${score} says "${expected}"`, async () => {
      expect(await headline(status, score)).toBe(expected);
    });
  }

  it("never says 'holds up' below 85 (the contradiction the QA audit found at 70)", async () => {
    for (let score = 0; score < 85; score++) {
      expect(await headline(score >= 70 ? "verified" : "rejected", score), String(score)).not.toMatch(/holds up/);
    }
  });
});

describe("states with no band to speak of keep their existing copy", () => {
  it("verified with no score (a human review) stays 'You're verified.'", async () => {
    expect(await headline("verified", null)).toBe("You're verified.");
  });
  it("rejected with no score (a human decision) keeps the existing line", async () => {
    expect(await headline("rejected", null)).toBe("Your last attempt wasn't verified — see the feedback below.");
  });
  it("unverified, pending and claimed are unchanged whatever an earlier score was", async () => {
    expect(await headline("unverified", null)).toBe("You haven't requested verification yet.");
    expect(await headline("pending", 90)).toBe("Your verification is being graded, or waiting for a reviewer to pick it up.");
    expect(await headline("claimed", 40)).toBe("A mentor is reviewing your submission now.");
  });
});

describe("the bands are tied to the grader's pass mark", () => {
  it("the copy's pass band starts exactly where the grader's pass mark does (70, unchanged)", async () => {
    const mod = await loadModule<Mod>("@/lib/talent-directory/verification-copy");
    expect(VERIFICATION_PASS_THRESHOLD).toBe(70);
    expect(mod.VERIFICATION_BAND_PASS).toBe(VERIFICATION_PASS_THRESHOLD);
  });
});
