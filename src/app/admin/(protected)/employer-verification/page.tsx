import { requirePermission } from "@/lib/admin/require-admin";
import { pendingCacVerifications } from "@/lib/admin/moderation/queues";
import { decideCacVerificationAction } from "@/lib/admin/moderation/actions";
import { DecisionForm } from "@/components/admin/decision-form";
import { QueueEmpty, QueueHeader } from "@/components/admin/queue-chrome";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

export const metadata = {
  title: "Employer verification — Talentrah admin",
  robots: { index: false, follow: false },
};

/** The portal itself, not a deep link — it does not support pre-filling a search. */
const CAC_PUBLIC_SEARCH_URL = "https://icrp.cac.gov.ng/public-search";

/**
 * Employers who submitted a CAC (business registration) number for manual
 * verification — "Path 2", for the employer a confirmed work-email domain
 * cannot reach (0113/0114).
 *
 * NOTHING HERE CALLS THE CAC PORTAL. It has no API and its own terms do not
 * offer one; the admin opens the plain public-search link themselves, looks
 * up the business name and RC number by hand, and only then decides. The link
 * is a bare button rather than a query-string deep link because the portal
 * does not support pre-filling a search — confirmed by checking it directly,
 * not assumed.
 *
 * APPROVING SETS `organizations.verified = true` DIRECTLY. Unlike ad campaign
 * review, there is no separate "go live" step to gate behind — verification
 * IS the grant, not a precondition for a later one, so there is exactly one
 * moment this org's postings become public and it is this button.
 */
export default async function EmployerVerificationQueuePage() {
  const admin = await requirePermission("employer_verification");
  const queue = await pendingCacVerifications();

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <QueueHeader
        eyebrow="Employer verification"
        title="CAC submissions awaiting manual confirmation."
        blurb="Check the business name and RC number against the public register yourself, then decide. Approving sets this organisation verified — its postings go public immediately. Rejecting leaves the submission as-is so the employer can correct and resubmit."
        adminLabel={admin.displayName || admin.email}
      />

      <p>
        <a
          href={CAC_PUBLIC_SEARCH_URL}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex min-h-11 items-center border-[1.5px] border-ink px-4 font-body text-[13.5px] font-semibold text-ink no-underline hover:border-rust hover:text-rust"
        >
          Open the CAC public register ↗
        </a>
      </p>

      {queue.length === 0 ? (
        <QueueEmpty>No CAC submissions are waiting.</QueueEmpty>
      ) : (
        <ul data-testid="employer-verification-queue" className="flex list-none flex-col gap-5 p-0">
          {queue.map((org) => (
            <li key={org.organizationId}>
              <BorderedCard className="flex flex-col gap-4 p-5">
                <div className="flex flex-col gap-1.5">
                  <EyebrowLabel>{org.organizationName}</EyebrowLabel>
                  <h2 className="font-display text-[20px] font-semibold leading-snug">
                    {org.cacBusinessName || "(no business name given)"}
                  </h2>
                  <p className="text-[13.5px] text-ink-soft">
                    RC number <span className="font-semibold text-ink">{org.cacNumber}</span>
                    {org.domain && <> · claimed domain {org.domain}</>}
                  </p>
                </div>

                <DecisionForm
                  id={org.organizationId}
                  action={decideCacVerificationAction}
                  decisionName="decision"
                  noteName="note"
                  notePlaceholder="Note (required to reject, kept in the audit log)"
                  options={[
                    { value: "approve", label: "Verify by CAC", variant: "primary" },
                    { value: "reject", label: "Reject", requiresNote: true },
                  ]}
                />
              </BorderedCard>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
