import Link from "next/link";
import { requireEmployer } from "@/lib/employer/membership";
import { createClient } from "@/lib/supabase/server";
import { getClaimCandidates } from "@/lib/employer/claim";
import { EyebrowLabel, Card, buttonClasses } from "@/components/ui";
import { ClaimCandidateCard } from "@/components/employer/claim-candidate-card";

export const metadata = { title: "Claim your company's listings — Talentrah" };

type SearchParams = Promise<{ onboarding?: string }>;

/**
 * "Claim your company's listings" (build-prompt §6.12) — the review screen.
 *
 * Reachable two ways, both landing here: `createOrganizationAction` redirects
 * straight to this page the moment a NEW organisation becomes verified and
 * has candidates (onboarding=1 just softens the copy — "while you're
 * here"); otherwise an employer finds this from the link Jobs Posted shows
 * whenever `job_posting_claim_candidates` has rows.
 *
 * Reactive only, on purpose (see this feature's PR description for the full
 * argument): §6.12 frames claiming as an invitation, which reads as
 * proactive outreach, but there is no contact channel for an aggregated
 * employer who never signed up — no email address exists for them anywhere
 * in this schema. So candidates are surfaced only once an employer
 * independently verifies; reaching out to an employer who never onboarded is
 * a separate, later growth-marketing effort, not an in-app surface.
 */
export default async function ClaimListingsPage({ searchParams }: { searchParams: SearchParams }) {
  const { organization } = await requireEmployer();
  const { onboarding } = await searchParams;
  const supabase = await createClient();

  if (!organization.verified) {
    return (
      <div className="max-w-[640px]">
        <EyebrowLabel>{organization.name}</EyebrowLabel>
        <h1 className="mt-2 font-display text-[28px] leading-[1.15] font-medium text-ink">
          Claim your company&apos;s listings
        </h1>
        <p className="mt-3 font-body text-[15px] text-ink-soft">
          Verify {organization.name} first — claiming matches an aggregated posting against your
          verified domain or company name, so there is nothing to check against yet.
        </p>
        <Link
          href="/employer/profile"
          className="mt-5 inline-block font-body text-[14px] font-semibold text-coral underline underline-offset-2"
        >
          Go to Company Profile
        </Link>
      </div>
    );
  }

  const candidates = await getClaimCandidates(supabase, organization.id);

  return (
    <div className="max-w-[760px]">
      <EyebrowLabel>{organization.name}</EyebrowLabel>
      <h1 className="mt-2 font-display text-[28px] leading-[1.15] font-medium text-ink">
        Claim your company&apos;s listings
      </h1>
      <p className="mt-3 max-w-[62ch] font-body text-[15px] text-ink-soft">
        {onboarding
          ? "Welcome — while you're here, we found some job postings from other sources that might already be yours."
          : "Postings we've aggregated from other sources that look like they might be yours."}{" "}
        Claiming one creates a brand-new posting your organisation fully owns and takes the old one
        out of the public feed — nothing is merged automatically, and nothing here changes on its
        own without you confirming it.
      </p>

      {candidates.length === 0 ? (
        <Card className="mt-7 p-6">
          <p className="font-body text-[14.5px] text-ink-soft">
            Nothing to claim right now. We check by matching an aggregated posting&apos;s source
            domain or company name against {organization.name} — if a role of yours shows up on
            another job board later, it will appear here.
          </p>
        </Card>
      ) : (
        <div className="mt-7 flex flex-col gap-4">
          {candidates.map((candidate) => (
            <ClaimCandidateCard key={candidate.id} candidate={candidate} />
          ))}
        </div>
      )}

      <Link
        href="/employer/jobs"
        className={`mt-8 inline-block ${buttonClasses("secondary", "md", "no-underline")}`}
      >
        {onboarding ? "Skip for now" : "Back to Jobs Posted"}
      </Link>
    </div>
  );
}
