import type { AdminPermission } from "./session";

/**
 * What an operator calls each area, for the one message `requirePermission` leaves behind when it bounces
 * them to /admin ("You no longer have access to Finance."). Keyed by permission, not by page: several pages
 * share a permission (Reported postings and Find a posting; Mentor review and Mentor payouts), so the area is
 * the honest unit. `Record<AdminPermission, …>` makes a new permission fail to compile until it has a name.
 */
export const PERMISSION_AREA_LABELS: Record<AdminPermission, string> = {
  blog: "Blog",
  feature_flags: "Feature flags",
  scholarships: "Scholarships",
  reported_postings: "Reported postings",
  ad_campaigns: "Ad campaigns",
  feedback: "Feedback",
  courses: "Courses",
  operations: "Operations",
  finance: "Finance",
  people: "People lookup",
  people_list: "Signups",
  employer_verification: "Employer verification",
  job_review: "Job review",
  mentor_review: "Mentor review",
  operators: "Operators",
};

/**
 * The area to name in the message, or null when there is nothing to say. `denied` comes off the URL, so it is
 * only ever used as a lookup key into the list above (never echoed), and it says nothing to an operator who
 * does hold that permission now (a stale or hand-typed link).
 */
export function deniedAreaLabel(denied: unknown, held: readonly AdminPermission[]): string | null {
  if (typeof denied !== "string") return null;
  if (!Object.prototype.hasOwnProperty.call(PERMISSION_AREA_LABELS, denied)) return null;
  const permission = denied as AdminPermission;
  if (held.includes(permission)) return null;
  return PERMISSION_AREA_LABELS[permission];
}
