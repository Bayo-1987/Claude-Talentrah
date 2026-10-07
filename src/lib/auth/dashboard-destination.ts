/**
 * Where "Go to your dashboard" lands (HWR-2). An organisation member is an employer and goes to /employer; everyone else, and anyone whose membership lookup failed, goes
 * to /jobs. A failed lookup must never send a seeker to a page that needs an organisation (/employer sends a person with none to employer onboarding).
 */
export function dashboardDestination(membership: { organizationId: string } | null | undefined): "/employer" | "/jobs" {
  return membership ? "/employer" : "/jobs";
}
