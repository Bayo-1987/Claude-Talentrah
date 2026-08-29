import { requireAdmin } from "@/lib/admin/require-admin";
import {
  stuckRenewals,
  autoApplyQueueHealth,
  rateLimitBuckets,
  feedFreshness,
  MAX_INDETERMINATE_RENEWAL_ATTEMPTS,
} from "@/lib/admin/ops/queries";
import { QueueHeader } from "@/components/admin/queue-chrome";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

export const metadata = {
  title: "Operations — Talentrah admin",
  robots: { index: false, follow: false },
};

const QUEUE_LABEL: Record<string, string> = {
  pending: "Waiting on the user",
  submitted: "Submitted",
  handed_off: "Handed off to the source site",
  dismissed: "Dismissed",
  expired: "Expired",
};

/**
 * What the system is doing when nobody is looking.
 *
 * READ ONLY — every figure is a SELECT and there is not one control on this
 * page. That is deliberate: the first version of an ops screen that grows a
 * "retry" button is the version that charges a card twice.
 *
 * The Pass section is the reason this exists. CLAUDE.md: "a cron that silently
 * stops firing means these Passes never resolve", and a row in
 * pending_renewal_reference is a charge of unknown outcome against a real
 * card. Nothing surfaced one before this.
 */
export default async function OpsPage() {
  const admin = await requireAdmin();
  const [renewals, queue, buckets, feeds] = await Promise.all([
    stuckRenewals(),
    autoApplyQueueHealth(),
    rateLimitBuckets(),
    feedFreshness(),
  ]);

  const exhausted = renewals.filter((r) => r.exhausted);

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <QueueHeader
        eyebrow="Operations"
        title="What is running, and what is stuck."
        blurb="Read-only. Nothing on this page changes anything — it exists so that a silently-stopped cron or an unresolved charge is visible before someone reports it."
        adminLabel={admin.displayName || admin.email}
      />

      {/* ---------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <EyebrowLabel>Pass renewals awaiting an answer</EyebrowLabel>
        {renewals.length === 0 ? (
          <BorderedCard className="p-5">
            <p className="font-display text-[15px] italic text-ink-soft">
              None outstanding. Every renewal has a known outcome.
            </p>
          </BorderedCard>
        ) : (
          <>
            {exhausted.length > 0 && (
              <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[14px] text-rust">
                {exhausted.length} {exhausted.length === 1 ? "Pass has" : "Passes have"} used all{" "}
                {MAX_INDETERMINATE_RENEWAL_ATTEMPTS} attempts. The customer may have been debited
                and lapsed anyway — Paystack never answered. These do not resolve on their own;
                the reference below is the thread back to the money.
              </p>
            )}
            <ul className="flex list-none flex-col gap-3 p-0">
              {renewals.map((r) => (
                <li key={r.id}>
                  <BorderedCard className="flex flex-col gap-1.5 p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <span className="font-display text-[17px]">
                        {r.userEmail ?? "account deleted"}
                      </span>
                      <span
                        className={
                          "text-[13px] " + (r.exhausted ? "font-semibold text-rust" : "text-ink-soft")
                        }
                      >
                        attempt {r.attempts}/{MAX_INDETERMINATE_RENEWAL_ATTEMPTS}
                        {r.exhausted ? " · given up" : " · retrying on the next daily run"}
                      </span>
                    </div>
                    <p className="text-[13.5px] text-ink-soft">
                      Paystack reference{" "}
                      <code className="text-[12.5px]">{r.pendingReference}</code>
                      {r.transactionStatus && ` · payment row is “${r.transactionStatus}”`}
                    </p>
                    <p className="text-[13.5px] text-ink-soft">
                      auto-renew {r.autoRenewStatus ?? "—"}
                      {r.nextRenewalDate &&
                        ` · next attempt ${new Date(r.nextRenewalDate).toLocaleDateString()}`}
                      {r.lastFailureAt &&
                        ` · last failure ${new Date(r.lastFailureAt).toLocaleDateString()}`}
                    </p>
                  </BorderedCard>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ---------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <EyebrowLabel>Ingest freshness</EyebrowLabel>
        {/*
          The caveat sits ON the screen, above the numbers, not in a comment.
          A figure that quietly means less than it appears to is worse than no
          figure — and this one genuinely cannot tell an empty run from a dead
          cron.
        */}
        <p className="max-w-[640px] font-display text-[14.5px] italic text-ink-soft">
          Derived from the last posting each source refreshed, because nothing
          records ingest runs. A run that succeeds and finds nothing new touches
          no rows, so it looks identical to a run that never happened. Read
          these as “when this source last produced something”, not “when the
          cron last fired”.
        </p>
        <BorderedCard className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-body text-[12px] font-bold uppercase tracking-[0.14em] text-ink-soft">Source</th>
                <th className="px-4 py-3 font-body text-[12px] font-bold uppercase tracking-[0.14em] text-ink-soft">Open / total</th>
                <th className="px-4 py-3 font-body text-[12px] font-bold uppercase tracking-[0.14em] text-ink-soft">Last refreshed</th>
              </tr>
            </thead>
            <tbody>
              {feeds.map((f) => (
                <tr key={f.key} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-3">
                    {f.label}
                    {!f.configured && !f.notIngested && (
                      <span className="ml-2 text-[12.5px] text-ink-soft">no longer configured</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {f.open} / {f.postings}
                  </td>
                  <td className="px-4 py-3">
                    {f.notIngested ? (
                      <span className="text-ink-soft">not ingested — employers post these</span>
                    ) : f.lastCheckedAt === null ? (
                      <span className="font-semibold text-rust">never seen</span>
                    ) : (
                      <>
                        {f.hoursSince}h ago
                        <span className="ml-2 text-[12.5px] text-ink-soft">
                          {new Date(f.lastCheckedAt).toLocaleString()}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </BorderedCard>
      </section>

      {/* ---------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <EyebrowLabel>Auto-Apply queue</EyebrowLabel>
        <BorderedCard className="flex flex-col gap-3 p-5">
          <ul className="flex list-none flex-wrap gap-x-8 gap-y-2 p-0 text-[14.5px]">
            {Object.entries(queue.byStatus).length === 0 && (
              <li className="font-display italic text-ink-soft">Queue is empty.</li>
            )}
            {Object.entries(queue.byStatus).map(([status, n]) => (
              <li key={status}>
                <span className="font-display text-[20px]">{n}</span>{" "}
                <span className="text-ink-soft">{QUEUE_LABEL[status] ?? status}</span>
              </li>
            ))}
          </ul>
          {queue.stalePending > 0 && (
            <p className="text-[13.5px] text-ink-soft">
              {queue.stalePending} pending {queue.stalePending === 1 ? "match has" : "matches have"}{" "}
              waited more than a day
              {queue.oldestPendingAt &&
                ` — oldest since ${new Date(queue.oldestPendingAt).toLocaleDateString()}`}
              . Pending means waiting on the user, so this is a signal about reach, not a fault.
            </p>
          )}
          <p className="font-display text-[13.5px] italic text-ink-soft">
            “Handed off” is not a failure — Auto-Apply never submits to external postings,
            because there is no ATS integration.
          </p>
        </BorderedCard>
      </section>

      {/* ---------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <EyebrowLabel>Rate limiting, last 24 hours</EyebrowLabel>
        <BorderedCard className="flex flex-col gap-3 p-5">
          {buckets.length === 0 ? (
            <p className="font-display text-[15px] italic text-ink-soft">
              Nothing rate-limited in the last day.
            </p>
          ) : (
            <ul className="flex list-none flex-col gap-2 p-0 text-[14.5px]">
              {buckets.map((b) => (
                <li key={b.bucket} className="flex flex-wrap justify-between gap-3">
                  <span>{b.bucket}</span>
                  <span className="text-ink-soft">
                    {b.requests} requests · {b.distinctUsers}{" "}
                    {b.distinctUsers === 1 ? "person" : "people"} · {b.windows} windows
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="font-display text-[13.5px] italic text-ink-soft">
            Aggregated on purpose. Who hit which limit is a behavioural profile of named people,
            and answering “is something being throttled” does not need it.
          </p>
        </BorderedCard>
      </section>
    </Container>
  );
}
