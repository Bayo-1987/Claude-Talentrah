import { getOptionalUser } from "@/lib/auth/require-user";
import { getEmployerContext } from "@/lib/employer/membership";
import { orgInitials as orgInitialsOf } from "@/lib/employer/org-initials";
import { EmployerMasthead } from "@/components/employer/employer-masthead";

/**
 * Separate shell from the seeker app: CLAUDE.md's IA gives employers their own
 * masthead, and the Farah panel is a job-seeker surface that has no place here.
 * Living outside the (app) route group is what makes that possible.
 *
 * send-350 — `/employer` (this segment's own bare page.tsx) is now a real
 * public marketing page for a signed-out visitor, so this layout can no
 * longer force `getEmployerContext()` (which calls `requireUser()`
 * internally) unconditionally — that would redirect a signed-out visitor to
 * /login before the marketing page ever rendered, the exact bug this send
 * fixes. `getOptionalUser()` first, and the employer app shell (masthead +
 * content wrapper) only renders for an actual session.
 *
 * This is NOT the security boundary and never was: every real dashboard
 * page under here (jobs, profile, campaigns, analytics, talent-directory,
 * claim) already calls `requireEmployer()` itself, and onboarding calls
 * `requireUser()` itself — this layout's own context fetch only ever fed
 * the masthead's org name/initials display. A signed-out visitor hitting
 * any of those routes directly still gets redirected to /login by that
 * page's own check, one level lower in the tree than before — same
 * outcome, not a new gap.
 */
export default async function EmployerLayout({ children }: { children: React.ReactNode }) {
  const session = await getOptionalUser();
  if (!session) {
    return <>{children}</>;
  }

  // Not requireEmployer(): /employer/onboarding lives under this layout and is
  // exactly where someone with no organisation belongs, so a redirect here
  // would loop.
  const context = await getEmployerContext();
  const orgName = context?.organization.name ?? "";
  // See lib/employer/org-initials.ts: null when there is no name, so the
  // masthead omits the badge rather than filling it with a placeholder.
  const orgInitials = orgInitialsOf(orgName);

  return (
    <div className="min-h-screen">
      <EmployerMasthead orgInitials={orgInitials} orgName={orgName} />
      <div className="mx-auto w-full max-w-[1120px] px-10 py-8">{children}</div>
    </div>
  );
}
