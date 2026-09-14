import { requirePermission } from "@/lib/admin/require-admin";
import { listMentorPayouts } from "@/lib/admin/mentor-payouts/queries";
import { QueueHeader, QueueEmpty } from "@/components/admin/queue-chrome";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";
import { RetryButton } from "./retry-button";

export const metadata = {
  title: "Mentor payouts — Talentrah admin",
  robots: { index: false, follow: false },
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  processing: "In progress",
  paid: "Paid",
  failed: "Failed",
};

/**
 * Read-only visibility plus one write action (manual retry) — send-141-ish
 * "Mentorship v2, part 1" brief: "doesn't need to be fancy, but it needs to
 * exist." Under `mentor_review`, not `finance` — see queries.ts's own header
 * for why.
 *
 * NOT A QUEUE IN THE admin-nav.tsx SENSE: most rows here are simply
 * `pending`, waiting on their hold window — that is not a backlog anyone
 * needs to act on, unlike a moderation queue. Only `failed` rows are
 * genuinely actionable, so the nav badge (src/lib/admin/mentor-payouts/
 * queries.ts's failedMentorPayoutCount) counts those specifically rather
 * than the total, matching financialHealth's own "count only what will not
 * fix itself" convention.
 */
export default async function MentorPayoutsPage() {
  const admin = await requirePermission("mentor_review");
  const payouts = await listMentorPayouts();

  const money = (ngn: number) => `₦${ngn.toLocaleString()}`;

  return (
    <Container className="flex max-w-[1000px] flex-col gap-8 py-12">
      <QueueHeader
        eyebrow="Mentor payouts"
        title="What's owed to mentors, and what's actually been paid."
        blurb="Paid automatically by Paystack Transfers 72 hours after a session completes. A bad review never blocks or claws back a payout — suspending a mentor (Mentor applications) is the real hold lever. Failed payouts are retryable."
        adminLabel={admin.displayName || admin.email}
      />

      {payouts.length === 0 ? (
        <QueueEmpty>No mentor payouts yet.</QueueEmpty>
      ) : (
        <BorderedCard className="overflow-x-auto p-0">
          <table className="w-full min-w-[820px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-body text-[12px] font-bold uppercase tracking-[0.08em] text-ink-soft">Mentor</th>
                <th className="px-4 py-3 font-body text-[12px] font-bold uppercase tracking-[0.08em] text-ink-soft">Amount</th>
                <th className="px-4 py-3 font-body text-[12px] font-bold uppercase tracking-[0.08em] text-ink-soft">Status</th>
                <th className="px-4 py-3 font-body text-[12px] font-bold uppercase tracking-[0.08em] text-ink-soft">Eligible</th>
                <th className="px-4 py-3 font-body text-[12px] font-bold uppercase tracking-[0.08em] text-ink-soft">Attempts</th>
                <th className="px-4 py-3 font-body text-[12px] font-bold uppercase tracking-[0.08em] text-ink-soft">Detail</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id} className="border-b border-line align-top last:border-b-0">
                  <td className="px-4 py-3">
                    <EyebrowLabel>{p.mentorName}</EyebrowLabel>
                  </td>
                  <td className="px-4 py-3 font-display">{money(p.amountNgn)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        "font-semibold " +
                        (p.status === "paid" ? "text-green" : p.status === "failed" ? "text-rust" : "text-ink")
                      }
                    >
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12.5px] text-ink-soft">
                    {new Date(p.eligibleAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">{p.attemptCount}</td>
                  <td className="px-4 py-3 max-w-[280px] text-[12.5px] text-ink-soft">
                    {p.status === "paid"
                      ? p.paystackTransferCode
                      : p.failureReason ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {p.status === "failed" && <RetryButton payoutId={p.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </BorderedCard>
      )}
    </Container>
  );
}
