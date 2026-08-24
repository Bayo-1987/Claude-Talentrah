/**
 * Pricing anchors from build-prompt §6.9 — researched, not validated (see §10 item 18).
 * bulletRewrite has no stated anchor in §6.9; 1 credit is an M9 proposal —
 * smallest unit action on the price list, well below a full tailoring run.
 */
export const CREDIT_COSTS = {
  tailoringRun: 5,
  coverLetterRun: 3,
  templateUnlock: 10,
  autoApplySubmission: 2,
  talentDirectoryVerification: 25,
  bulletRewrite: 1,
  // §6.15 / §6.9 — both are stated anchors on the decided price list, not
  // proposals: eligibility check 2 credits (₦300), SOP drafting 4 credits
  // (₦600, a tier above cover letters for a longer piece).
  scholarshipEligibilityCheck: 2,
  scholarshipSopDraft: 4,
} as const;
