/**
 * What /talent-directory/verify says about a verification state, by score band (send-495, S19).
 *
 * The grader has ONE threshold: `passed = score >= VERIFICATION_PASS_THRESHOLD` (70). The page used to have one
 * sentence per STATUS, so a 70 and a 98 both read as a resume that "holds up", beside feedback that could say it
 * lacked key details. The bands below are the owner's wording (2026-10-01) and are copy only: they do not change
 * who passes. Kept free of `server-only` imports (verification.ts pulls in the LLM) so the page and the tests can
 * use it directly; tests/talent-directory/verification-headline.test.ts ties `VERIFICATION_BAND_PASS` to the
 * grader's real threshold so the two cannot drift apart.
 */

/** Where the "Verified" copy begins. Mirrors VERIFICATION_PASS_THRESHOLD (tested equal). */
export const VERIFICATION_BAND_PASS = 70;

/** Where "your resume holds up" begins. Below it, a pass still has things to tighten. */
export const VERIFICATION_BAND_STRONG = 85;

/** The line for each status that has no score band to speak of. Unchanged from the page's old STATUS_COPY. */
const STATUS_COPY: Record<string, string> = {
  unverified: "You haven't requested verification yet.",
  pending: "Your verification is being graded, or waiting for a reviewer to pick it up.",
  claimed: "A mentor is reviewing your submission now.",
  verified: "You're verified.",
  rejected: "Your last attempt wasn't verified — see the feedback below.",
};

/**
 * The status line for a verification state.
 *
 * Status decides first, score second: `pending` and `claimed` say so whatever an earlier attempt scored. Bands apply
 * only to a graded outcome, a `verified` or `rejected` row with a score. A human-reviewed verification has no
 * score, and a verified row can never be below the pass mark through the grader, so both fall back to the plain line
 * rather than put a band claim next to a status it contradicts.
 */
export function verificationHeadline(status: string, score: number | null): string {
  if (score != null) {
    if (status === "verified" && score >= VERIFICATION_BAND_STRONG) return "Verified — your resume holds up";
    if (status === "verified" && score >= VERIFICATION_BAND_PASS) return "Verified — a few things to tighten";
    if (status === "rejected" && score < VERIFICATION_BAND_PASS) return "Not verified yet — here's what to fix";
  }
  return STATUS_COPY[status] ?? status;
}
