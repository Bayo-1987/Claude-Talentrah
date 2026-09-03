/**
 * Founder-decided rebase (2026-09-03) — CREDIT_COSTS pins the exact values,
 * not just "some value". A silent drift here (someone "rounding" a cost
 * during a later refactor) would desync the price a user is shown from
 * what actually gets charged, which is a worse bug than any single wrong
 * number because nothing else would notice it.
 */
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS } from "@/lib/credits/costs";

describe("CREDIT_COSTS matches the founder-decided rebase exactly", () => {
  it.each([
    ["tailoringRun", 20],
    ["scholarshipSopDraft", 16],
    ["coverLetterRun", 10],
    ["autoApplySubmission", 4],
    ["scholarshipEligibilityCheck", 4],
    ["bulletRewrite", 2],
    ["templateUnlock", 10],
    ["talentDirectoryVerification", 25],
  ] as const)("%s = %i credits", (key, expected) => {
    expect(CREDIT_COSTS[key]).toBe(expected);
  });

  it("the anchor holds: Starter (20 credits, ₦2,500) equals exactly one tailoring run", () => {
    const NGN_PER_CREDIT = 125; // ₦2,500 / 20 credits — the founder's own anchor
    expect(CREDIT_COSTS.tailoringRun * NGN_PER_CREDIT).toBe(2500);
  });

  it("autoApplySubmission deliberately only doubled, not quadrupled like the rest", () => {
    const OLD_AUTO_APPLY = 2;
    expect(CREDIT_COSTS.autoApplySubmission).toBe(OLD_AUTO_APPLY * 2);
  });

  it("templateUnlock and talentDirectoryVerification are UNCHANGED from before the rebase", () => {
    expect(CREDIT_COSTS.templateUnlock).toBe(10);
    expect(CREDIT_COSTS.talentDirectoryVerification).toBe(25);
  });
});
