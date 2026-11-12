import { normaliseApplyEmail } from "@/lib/jobs/apply-email";

/**
 * "Does this posting take applications by email?" for every surface that decides how a seeker can apply (PR-E2b). The posting's stored address, judged by the one helper that refuses
 * anything that is not one plain address, or null. It is the ONLY place outside the select lists and the employer write path that reads `job.apply_email`, so a surface asks this and
 * never names the column (tests/jobs/apply-email-leaks.test.ts keeps that list short). A row from a path that does not select the column has no address here: undefined is null.
 */
export interface ApplyEmailFields {
  apply_email?: string | null;
  /** PR-E4: 'company' or 'ats' when the employer chose "On our career site"; the kind is what the pages and the guards read (the address itself is readable by no API role). */
  apply_link_kind?: string | null;
  /** PR-E4: the host of that link, for the button's accessible name only (never printed). */
  apply_link_host?: string | null;
}

/** The normalised address, or null. For display only behind "Apply by email" and "Copy address" (never as text). */
export function postingApplyEmail(job: ApplyEmailFields | null | undefined): string | null {
  return normaliseApplyEmail(job?.apply_email);
}

/** True when the posting's applications arrive by email: no in-app Apply, no screening, no resume check, no applicant count, never queued by Auto-Apply. */
export function takesApplicationsByEmail(job: ApplyEmailFields | null | undefined): boolean {
  return postingApplyEmail(job) !== null;
}

/** PR-E4: true when the employer sent applications to their own career site ("company" for their domain, "ats" for an applicant-tracking page). */
export function takesApplicationsByLink(job: ApplyEmailFields | null | undefined): boolean {
  const kind = job?.apply_link_kind;
  return kind === "company" || kind === "ats";
}

/** PR-E4: true when applications go anywhere but Talentrah: an e-mail address OR a career-site link. Every place that decides "can a seeker apply here" asks this one. */
export function takesApplicationsOffPlatform(job: ApplyEmailFields | null | undefined): boolean {
  return takesApplicationsByEmail(job) || takesApplicationsByLink(job);
}

/** PR-E4: the host for the "Apply on company site" button's accessible name (never printed as text), only when there is a link kind AND a plain host; otherwise null. */
export function postingApplyLinkHost(job: ApplyEmailFields | null | undefined): string | null {
  if (!takesApplicationsByLink(job)) return null;
  const host = job?.apply_link_host;
  return typeof host === "string" && host.includes(".") && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) ? host : null;
}
