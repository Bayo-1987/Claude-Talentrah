import type { Side } from "./side-preference";

/**
 * Where "Go to your dashboard" lands (HWR-2). An organisation member is an employer and goes to /employer; everyone else, and anyone whose membership lookup failed, goes
 * to /jobs. A failed lookup must never send a seeker to a page that needs an organisation (/employer sends a person with none to employer onboarding).
 *
 * `preference` is the tr_side cookie (src/lib/auth/side-preference.ts), already parsed. It can only choose between the two homes of someone who IS a member: a member whose preference is
 * "seeker" goes to /jobs; a member with no preference, or "employer", goes to /employer as before; a non-member goes to /jobs whatever the preference says.
 */
export function dashboardDestination(membership: { organizationId: string } | null | undefined, preference?: Side | null): "/employer" | "/jobs" {
  if (!membership) return "/jobs";
  return preference === "seeker" ? "/jobs" : "/employer";
}
