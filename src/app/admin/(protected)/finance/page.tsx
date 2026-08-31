import Link from "next/link";
import { requirePermission } from "@/lib/admin/require-admin";
import { financialHealth } from "@/lib/admin/finance/queries";
import { QueueHeader } from "@/components/admin/queue-chrome";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

export const metadata = {
  title: "Financial health — Talentrah admin",
  robots: { index: false, follow: false },
};

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(minor / 100);

/**
 * Money in aggregate. NO PERSONAL DATA ON THIS PAGE AT ALL — no name, no
 * email, no user id.
 *
 * That is what makes it the landing surface. It answers "is the money
 * healthy", which needs counts and not people; and keeping it free of
 * individuals is what allows the person lookup next door to be a deliberate
 * act rather than a click from a list an operator was already reading.
 *
 * READ ONLY, with no adjustment path anywhere. `spendCredits` looked correct
 * for months and let two concurrent spends both succeed at `balance == cost`
 * (0035). An admin balance-edit button is that bug with different paperwork.
 */
export default async function FinancialHealthPage() {
  const admin = await requirePermission("finance");
  const health = await financialHealth();

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <QueueHeader
        eyebrow="Financial health"
        title="Where the money is, and where it is stuck."
        blurb="Totals only — no names, no emails, no ids. Read-only: there is no way to adjust a balance from this dashboard, deliberately."
        adminLabel={admin.displayName || admin.email}
      />

      {health.pendingCount > 0 && (
        <p
          className={
            "border-[1.5px] px-3.5 py-2.5 text-[14px] " +
            (health.stalePending > 0
              ? "border-rust bg-rust-soft text-rust"
              : "border-ink bg-card text-ink")
          }
        >
          {health.pendingCount} payment{health.pendingCount === 1 ? "" : "s"} pending
          {health.stalePending > 0 &&
            ` — ${health.stalePending} older than a day. A pending row is an outcome nobody has learned, not a failure.`}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <EyebrowLabel>Payments by status and rail</EyebrowLabel>
        <BorderedCard className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-[14px]">
            <tbody>
              {health.payments.map((p) => (
                <tr key={`${p.status}-${p.rail}-${p.currency}`} className="border-b border-line last:border-b-0">
                  <td className={"px-4 py-3 " + (p.status === "pending" ? "font-semibold text-rust" : "")}>
                    {p.status}
                  </td>
                  <td className="px-4 py-3">{p.rail}</td>
                  <td className="px-4 py-3">{p.count}</td>
                  <td className="px-4 py-3">{money(p.totalMinor, p.currency)}</td>
                  <td className="px-4 py-3 text-[12.5px] text-ink-soft">
                    oldest {new Date(p.oldestAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {health.payments.length === 0 && (
                <tr>
                  <td className="px-4 py-3 font-display italic text-ink-soft">No payments yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </BorderedCard>
      </section>

      <section className="flex flex-col gap-2">
        <EyebrowLabel>Passes</EyebrowLabel>
        <BorderedCard className="flex flex-col gap-2 p-5">
          <ul className="flex list-none flex-wrap gap-x-8 gap-y-2 p-0 text-[14.5px]">
            {Object.entries(health.passesByStatus).map(([status, n]) => (
              <li key={status}>
                <span className="font-display text-[20px]">{n}</span>{" "}
                <span className="text-ink-soft">{status}</span>
              </li>
            ))}
            {Object.keys(health.passesByStatus).length === 0 && (
              <li className="font-display italic text-ink-soft">No passes.</li>
            )}
          </ul>
          {health.passesAwaitingRenewalOutcome > 0 && (
            <p className="text-[13.5px] text-rust">
              {health.passesAwaitingRenewalOutcome} awaiting a renewal outcome —{" "}
              <Link href="/admin/ops" className="underline">
                see Operations
              </Link>{" "}
              for attempt counts and references.
            </p>
          )}
        </BorderedCard>
      </section>

      <section className="flex flex-col gap-2">
        <EyebrowLabel>Credit movements by reason</EyebrowLabel>
        <BorderedCard className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-[14px]">
            <tbody>
              {health.creditsByReason.map((c) => (
                <tr key={c.reason} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-3">{c.reason}</td>
                  <td className="px-4 py-3 text-ink-soft">{c.entries} entries</td>
                  <td className="px-4 py-3">{c.net > 0 ? `+${c.net}` : c.net} net</td>
                </tr>
              ))}
              {health.creditsByReason.length === 0 && (
                <tr>
                  <td className="px-4 py-3 font-display italic text-ink-soft">No movements.</td>
                </tr>
              )}
            </tbody>
          </table>
        </BorderedCard>
      </section>

      <section className="flex flex-col gap-2">
        <EyebrowLabel>Ad wallets</EyebrowLabel>
        <BorderedCard className="p-5 text-[14.5px]">
          {health.adWalletCount === 0 ? (
            <span className="font-display italic text-ink-soft">No ad wallets yet.</span>
          ) : (
            <>
              <span className="font-display text-[20px]">
                {money(health.adWalletBalanceNgn * 100, "NGN")}
              </span>{" "}
              <span className="text-ink-soft">
                held across {health.adWalletCount}{" "}
                {health.adWalletCount === 1 ? "wallet" : "wallets"}
              </span>
            </>
          )}
        </BorderedCard>
      </section>

      <p className="text-[14px] text-ink-soft">
        Investigating one person&apos;s billing?{" "}
        <Link href="/admin/people" className="underline">
          Look up a person
        </Link>
        . That surface shows billing records for one account and records the lookup.
      </p>
    </Container>
  );
}
