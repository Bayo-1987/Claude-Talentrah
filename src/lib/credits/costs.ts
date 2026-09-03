/**
 * Founder-decided repricing (2026-09-03), replacing the original build-prompt
 * §6.9 anchors (researched, not validated) with a single fixed anchor: ₦2,500
 * = one CV tailoring. Starter is priced at 20 credits for ₦2,500, so a
 * credit is worth exactly ₦125 — every other cost below is a founder-chosen
 * multiple of tailoringRun, not an independent re-derivation from §6.9.
 *
 * The pass-holder cost-probe review (2026-09-03) measured real per-action
 * LLM spend against these prices before they were approved — see that
 * review for the margin numbers; nothing here needed retuning as a result.
 *
 * Two deliberate exceptions to "everything moved with the anchor":
 *   - autoApplySubmission only doubled (2 -> 4), not quadrupled like the
 *     rest. Auto-Apply is the engagement engine — the free weekly allowance
 *     is the thing that gets people to trust the product before they ever
 *     pay for anything — and it has to stay affordable even after the
 *     rebase, or the funnel it exists to build gets more expensive to enter
 *     right when the rest of the price list got less so.
 *   - templateUnlock and talentDirectoryVerification are UNCHANGED. Both
 *     are one-time purchases already priced fairly on their own terms
 *     (₦1,250 and ₦3,125 respectively) rather than against the tailoring
 *     anchor, so the rebase has nothing to correct for either.
 *
 * The ×4 that moved from 5 credits to 20 also drove a one-time balance
 * migration (0090_balance_rebase_4x.sql): every existing credits_balance
 * was multiplied by four so a balance that already paid for N tailorings
 * still buys N tailorings after the rebase, not N/4.
 */
export const CREDIT_COSTS = {
  tailoringRun: 20, // ₦2,500 — the anchor
  scholarshipSopDraft: 16, // ₦2,000
  coverLetterRun: 10, // ₦1,250
  autoApplySubmission: 4, // ₦500 — deliberately ×2, not ×4 (see header)
  scholarshipEligibilityCheck: 4, // ₦500
  bulletRewrite: 2, // ₦250
  templateUnlock: 10, // ₦1,250 — UNCHANGED, already fairly priced
  talentDirectoryVerification: 25, // ₦3,125 — UNCHANGED, already fairly priced
} as const;
