/**
 * `isQueueableMatchScore` (src/lib/auto-apply/queue.ts) is `scanAndQueue`'s
 * upstream half of the thin-match gate — the confirm-time backstop lives in
 * `auto_apply_claim_submission` (0034/0164), but a user should never see a
 * candidate in their Auto-Apply queue that the atomic gate is only ever
 * going to refuse. See docs/stage8-match-accuracy.md: 65% of every
 * "Excellent" score this system has ever computed sits on a screenable-tag
 * denominator of 1 or fewer.
 *
 * Pure, DB-free unit test — matches this repo's own convention
 * (`filterQueueableJobs`'s sibling test file). The real-database proof that
 * the RPC-level gate refuses a thin match regardless is
 * `tests/auto-apply/thin-match-gate.test.ts`.
 *
 * Boundary values are derived from `THIN_SCREENABLE_TAG_MAX`
 * (src/lib/match-tier.ts) rather than hardcoded, so this test breaks if that
 * constant ever changes without a matching review here.
 */
import { describe, expect, it } from "vitest";
import { isQueueableMatchScore } from "@/lib/auto-apply/queue";
import { THIN_SCREENABLE_TAG_MAX } from "@/lib/match-tier";

function explanationWithTags(matchedCount: number, missingCount: number) {
  return {
    matchedSkills: Array.from({ length: matchedCount }, (_, i) => `matched-${i}`),
    missingSkills: Array.from({ length: missingCount }, (_, i) => `missing-${i}`),
    seniorityAlignment: "unknown" as const,
  };
}

describe("SABOTAGE-PROOF TARGET: isQueueableMatchScore", () => {
  it("excludes a match at exactly the thin boundary (THIN_SCREENABLE_TAG_MAX total tags)", () => {
    const explanation = explanationWithTags(THIN_SCREENABLE_TAG_MAX, 0);
    expect(isQueueableMatchScore(explanation)).toBe(false);
  });

  it("excludes a single-tag match (the real production shape, per stage8-match-accuracy.md)", () => {
    const explanation = explanationWithTags(1, 0);
    expect(isQueueableMatchScore(explanation)).toBe(false);
  });

  it("excludes a zero-tag match", () => {
    const explanation = explanationWithTags(0, 0);
    expect(isQueueableMatchScore(explanation)).toBe(false);
  });

  it("keeps a match one tag above the thin boundary", () => {
    const explanation = explanationWithTags(THIN_SCREENABLE_TAG_MAX + 1, 0);
    expect(isQueueableMatchScore(explanation)).toBe(true);
  });

  it("counts matched and missing tags together, not just matched", () => {
    // 1 matched + 2 missing = 3 total, one above a THIN_SCREENABLE_TAG_MAX of 2.
    const explanation = explanationWithTags(1, THIN_SCREENABLE_TAG_MAX);
    const total = 1 + THIN_SCREENABLE_TAG_MAX;
    expect(isQueueableMatchScore(explanation)).toBe(total > THIN_SCREENABLE_TAG_MAX);
  });

  it("treats a missing/malformed explanation as thin (fails closed, not open)", () => {
    expect(isQueueableMatchScore(null)).toBe(false);
    expect(isQueueableMatchScore(undefined)).toBe(false);
    expect(isQueueableMatchScore({})).toBe(false);
    expect(isQueueableMatchScore({ matchedSkills: "not-an-array" })).toBe(false);
  });
});
