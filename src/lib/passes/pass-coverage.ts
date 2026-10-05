/**
 * Which credit-priced actions an active Pass covers: the ONE list the billing page marks "Included" from.
 *
 * It describes what the gates already do; it never decides anything. `checkPassCoverage` (src/lib/passes/entitlement.ts) is what
 * covers an action, and the call sites below are what ask it. tests/passes/pass-coverage-list.test.ts reads those source files and
 * fails if this list and the call sites disagree, in either direction, so a gate gaining or losing pass coverage cannot leave the
 * page saying the old thing.
 *
 * Typed as a Record over `CREDIT_COSTS`' keys: adding an action there without deciding it here is a compile error.
 *
 *   tailoringRun, coverLetterRun        src/lib/tailoring/gate.ts            checkTailoringAllowance
 *   bulletRewrite                       src/lib/resume-builder/actions.ts    rewriteBulletAction
 *   farahChatMessage                    src/lib/farah/chat-gate.ts           checkFarahChatAllowance (after the free messages)
 *   autoApplySubmission                 src/lib/auto-apply/actions.ts        (beyond the free weekly allowance)
 *   scholarshipEligibilityCheck         src/lib/scholarships/actions.ts      runEligibilityCheckAction
 *   scholarshipSopDraft                 src/lib/scholarships/actions.ts      draftSopAction
 *
 * Not covered, on purpose: a template unlock, Talent Directory verification (with or without human review) and a boost are sold for
 * credits only. Nothing under src/lib/talent-directory calls the entitlement check, and the template unlock spends credits directly.
 */
import type { CREDIT_COSTS } from "@/lib/credits/costs";

export type CreditAction = keyof typeof CREDIT_COSTS;

export const PASS_COVERAGE: Record<CreditAction, "pass" | "credits_only"> = {
  tailoringRun: "pass",
  coverLetterRun: "pass",
  bulletRewrite: "pass",
  farahChatMessage: "pass",
  autoApplySubmission: "pass",
  scholarshipEligibilityCheck: "pass",
  scholarshipSopDraft: "pass",
  templateUnlock: "credits_only",
  talentDirectoryVerification: "credits_only",
  talentDirectoryHumanReview: "credits_only",
  talentDirectoryBoost: "credits_only",
};

/** Said next to "Included" where the cover only starts once a free allowance is used up. */
export const PASS_COVERAGE_NOTE: Partial<Record<CreditAction, string>> = {
  farahChatMessage: "after your free messages",
};

export function coveredByPass(action: CreditAction): boolean {
  return PASS_COVERAGE[action] === "pass";
}
