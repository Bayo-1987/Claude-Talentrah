import { requirePermission } from "@/lib/admin/require-admin";
import { pendingCampaigns } from "@/lib/admin/moderation/queues";
import { decideCampaignAction } from "@/lib/admin/moderation/actions";
import { DecisionForm } from "@/components/admin/decision-form";
import { QueueEmpty, QueueHeader } from "@/components/admin/queue-chrome";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

export const metadata = {
  title: "Ad campaign review — Talentrah admin",
  robots: { index: false, follow: false },
};

const naira = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

/**
 * Campaigns awaiting review.
 *
 * APPROVING DOES NOT START ONE, and the page says so twice — in the blurb and
 * on the button — because it is the single thing an operator is most likely to
 * assume wrongly. An approved campaign lands in `paused_by_employer`; going
 * live is the employer's `resume_ad_campaign`, which debits the ad wallet. One
 * path from not-running to running, and it always charges.
 *
 * The organisation's verification state is shown next to its name because it
 * is the fact most likely to change the decision: an unverified organisation
 * running paid ads is worth a second look, and it is not otherwise visible
 * from the campaign itself.
 */
export default async function CampaignQueuePage() {
  const admin = await requirePermission("ad_campaigns");
  const queue = await pendingCampaigns();

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <QueueHeader
        eyebrow="Ad campaign review"
        title="Campaigns waiting on a decision."
        blurb="Review is about the ad's content. Approving does not start it or spend anything — an approved campaign stays paused until the employer resumes it, which is when it first charges."
        adminLabel={admin.displayName || admin.email}
      />

      {queue.length === 0 ? (
        <QueueEmpty>Nothing awaiting review.</QueueEmpty>
      ) : (
        <ul className="flex list-none flex-col gap-5 p-0">
          {queue.map((c) => (
            <li key={c.id}>
              <BorderedCard className="flex flex-col gap-4 p-5">
                <div className="flex flex-col gap-1.5">
                  <EyebrowLabel>
                    {c.organisation?.name ?? "Unknown organisation"}
                    {c.organisation && !c.organisation.verified && " · unverified"}
                  </EyebrowLabel>
                  <h2 className="font-display text-[20px] font-semibold leading-snug">
                    {c.name}
                  </h2>
                  <p className="text-[13.5px] text-ink-soft">
                    {c.posting ? c.posting.title : "Posting unavailable"}
                    {c.posting?.location && ` · ${c.posting.location}`}
                  </p>
                  <p className="text-[13.5px] text-ink-soft">
                    {naira.format(c.dailyRateNgn)} per day
                    {c.totalBudgetNgn != null && ` · budget ${naira.format(c.totalBudgetNgn)}`}
                    {c.submittedAt &&
                      ` · submitted ${new Date(c.submittedAt).toLocaleDateString()}`}
                  </p>
                  {c.organisation?.domain && (
                    <p className="text-[13.5px] text-ink-soft">{c.organisation.domain}</p>
                  )}
                </div>

                <DecisionForm
                  id={c.id}
                  action={decideCampaignAction}
                  notePlaceholder="Note — required to reject, shown to the employer"
                  options={[
                    { value: "approve", label: "Approve (stays paused)", variant: "primary" },
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
