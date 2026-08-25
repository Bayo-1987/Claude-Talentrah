import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { getEmployerContext } from "@/lib/employer/membership";
import { emailDomain, isConsumerEmailDomain } from "@/lib/employer/verification";
import { EyebrowLabel } from "@/components/ui";
import { OrgOnboardingForm, type JoinableOrg } from "@/components/employer/org-onboarding-form";

export const metadata = { title: "Set up your company — Talentrah" };

export default async function EmployerOnboardingPage() {
  const existing = await getEmployerContext();
  if (existing) redirect("/employer/jobs");

  const { user } = await requireUser();
  const domain = emailDomain(user.email);

  /*
   * Only offer to join a company that is BOTH verified and on the user's own
   * work-email domain — the same rule joinOrganizationAction enforces server
   * side. Listing anything looser would turn this page into a directory of
   * every organisation on the platform, which is a disclosure problem even
   * though `organizations` is publicly readable: the point is not to make
   * discovery convenient, it is to reunite colleagues.
   *
   * Consumer domains are excluded, otherwise every gmail.com user would be
   * offered every gmail.com-registered org.
   */
  let joinable: JoinableOrg[] = [];
  if (domain && !isConsumerEmailDomain(domain)) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("domain", domain)
      .eq("verified", true)
      .limit(5);
    joinable = data ?? [];
  }

  return (
    <div className="max-w-[720px]">
      <EyebrowLabel>Employers</EyebrowLabel>
      <h1 className="mt-2 font-display text-[34px] leading-[1.15] font-medium text-ink">
        Hire on Talentrah
      </h1>
      <p className="mt-3 max-w-[56ch] font-body text-[15.5px] text-ink-soft">
        Post roles to a pool of job seekers who are actively matching against them. Free while
        we&apos;re building out the employer tools.
      </p>

      <div className="mt-9">
        <OrgOnboardingForm
          joinable={joinable}
          userEmail={user.email ?? null}
          emailConfirmed={!!user.email_confirmed_at}
          suggestedDomain={domain && !isConsumerEmailDomain(domain) ? domain : null}
        />
      </div>
    </div>
  );
}
