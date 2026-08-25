import { getEmployerContext } from "@/lib/employer/membership";
import { EmployerMasthead } from "@/components/employer/employer-masthead";

/**
 * Separate shell from the seeker app: CLAUDE.md's IA gives employers their own
 * masthead, and the Farah panel is a job-seeker surface that has no place here.
 * Living outside the (app) route group is what makes that possible.
 */
export default async function EmployerLayout({ children }: { children: React.ReactNode }) {
  // Not requireEmployer(): /employer/onboarding lives under this layout and is
  // exactly where someone with no organisation belongs, so a redirect here
  // would loop.
  const context = await getEmployerContext();
  const orgName = context?.organization.name ?? "";
  const orgInitials =
    orgName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "—";

  return (
    <div className="min-h-screen">
      <EmployerMasthead orgInitials={orgInitials} orgName={orgName} />
      <div className="mx-auto w-full max-w-[1120px] px-10 py-8">{children}</div>
    </div>
  );
}
