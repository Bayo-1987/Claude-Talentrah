/**
 * What an employer's applicant list may know about an applicant's talent verification.
 *
 * Only a VERIFIED state is passed on. Anything else (rejected, pending, claimed, unverified, unknown) collapses to "unverified" with no score, so a failed attempt, including a flagged one
 * (a resume that tried to instruct the grader, recorded as rejected with score 0), never reaches an employer, not even as data in the page the browser receives. The list itself already
 * shows only the "Verified" line; this keeps the rest out of the payload as well.
 */
export function employerVisibleVerification(status: string, score: number | null): { status: "verified" | "unverified"; score: number | null } {
  return status === "verified" ? { status: "verified", score } : { status: "unverified", score: null };
}
