import { normaliseApplyEmail } from "@/lib/jobs/apply-email";
import { isLinkOutPosting, type LinkOutFields } from "@/lib/jobs/link-out";

/**
 * "Does this posting take applications by email?" for every surface that decides how a seeker can apply (PR-E2b). The posting's stored address, judged by the one helper that refuses
 * anything that is not one plain address, or null. It is the ONLY place outside the select lists and the employer write path that reads `job.apply_email`, so a surface asks this and
 * never names the column (tests/jobs/apply-email-leaks.test.ts keeps that list short). A row from a path that does not select the column has no address here: undefined is null.
 */
export interface ApplyEmailFields {
  apply_email?: string | null;
}

/** The normalised address, or null. For display only behind "Apply by email" and "Copy address" (never as text). */
export function postingApplyEmail(job: ApplyEmailFields | null | undefined): string | null {
  return normaliseApplyEmail(job?.apply_email);
}

/** True when the posting's applications arrive by email: no in-app Apply, no screening, no resume check, no applicant count, never queued by Auto-Apply. */
export function takesApplicationsByEmail(job: ApplyEmailFields | null | undefined): boolean {
  return postingApplyEmail(job) !== null;
}

/** True only for a posting seekers can apply to INSIDE Talentrah: not link-out, and no address. */
export function takesApplicationsInApp(job: LinkOutFields & ApplyEmailFields): boolean {
  return !isLinkOutPosting(job) && !takesApplicationsByEmail(job);
}
