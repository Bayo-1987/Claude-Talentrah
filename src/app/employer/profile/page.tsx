import { requireEmployer } from "@/lib/employer/membership";
import {
  evaluateDomainVerification,
  verificationMessage,
} from "@/lib/employer/verification";
import { EyebrowLabel } from "@/components/ui";
import { CompanyProfileForm } from "@/components/employer/company-profile-form";

export const metadata = { title: "Company Profile — Talentrah" };

export default async function CompanyProfilePage() {
  const { organization, userEmail, emailConfirmed } = await requireEmployer();

  // Recomputed from the CURRENT stored domain, so the explanation always
  // describes the state the employer is actually in rather than the one they
  // were in when the org was created.
  const outcome = evaluateDomainVerification({
    userEmail,
    emailConfirmed,
    claimedDomain: organization.domain,
  });

  return (
    <div className="max-w-[720px]">
      <EyebrowLabel>Employers</EyebrowLabel>
      <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">
        Company Profile
      </h1>

      <div className="mt-5 flex items-center gap-3">
        <span
          className={
            organization.verified
              ? "border-[1.5px] border-green px-2.5 py-1 font-body text-[11px] font-bold tracking-[0.14em] text-green uppercase"
              : "border-[1.5px] border-amber px-2.5 py-1 font-body text-[11px] font-bold tracking-[0.14em] text-amber uppercase"
          }
        >
          {organization.verified ? "Verified" : "Unverified"}
        </span>
        <p className="font-body text-[13.5px] text-ink-soft">
          {organization.verified
            ? "Your jobs appear in the public job feed."
            : "Your jobs stay private to your team until this is verified."}
        </p>
      </div>

      <div className="mt-7">
        <CompanyProfileForm
          initial={{
            name: organization.name,
            domain: organization.domain ?? "",
            description: organization.description ?? "",
            logoUrl: organization.logo_url ?? "",
          }}
          verificationNote={verificationMessage(outcome, userEmail)}
        />
      </div>

      {/*
        Stated plainly rather than dressed up. CLAUDE.md records work-email-domain
        verification as an ASSUMPTION standing in for an open founder decision,
        and an employer reading this page deserves to know how thin the check is
        rather than inferring a badge means more than it does.
      */}
      <p className="mt-6 max-w-[60ch] font-body text-[12.5px] text-ink-soft">
        Verification currently means one thing: someone with a confirmed email address at this
        domain set the company up. It doesn&apos;t confirm they speak for the company.
      </p>
    </div>
  );
}
