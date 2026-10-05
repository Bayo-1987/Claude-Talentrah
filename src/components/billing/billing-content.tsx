import { BalancePanel } from "@/components/billing/balance-panel";
import { PassCards } from "@/components/billing/pass-cards";
import { ActivityTable } from "@/components/billing/activity-table";
import { CreditPriceList } from "@/components/billing/credit-price-list";
import { EyebrowLabel } from "@/components/ui";
import type { ActivityRow, PackRow, PassProductRow, PassSplit } from "@/lib/billing/billing-view";

const SECTION_HEADING = "border-b-[1.5px] border-ink pb-3";

/**
 * Everything on the billing page below the title block and its banners: the ink panel, the passes, recent activity and the credit
 * price list. Pure props in, markup out, so the page (which reads Supabase) and a QA fixture can render the SAME thing.
 */
export function BillingContent({
  balance,
  packs,
  passes,
  split,
  rows,
  now,
}: {
  balance: number;
  packs: readonly (PackRow & { price_ngn: number })[];
  passes: readonly PassProductRow[];
  split: PassSplit;
  rows: ActivityRow[];
  now: number;
}) {
  return (
    <>
      <BalancePanel balance={balance} packs={packs} split={split} lowestPass={passes[0] ?? null} now={now} />

      <section id="passes" className="flex flex-col gap-4">
        <h2 className={SECTION_HEADING}>
          <EyebrowLabel size="sm">Passes</EyebrowLabel>
        </h2>
        <PassCards passes={passes} current={split.leading} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className={SECTION_HEADING}>
          <EyebrowLabel size="sm">Recent activity</EyebrowLabel>
        </h2>
        <ActivityTable rows={rows} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={SECTION_HEADING}>
          <EyebrowLabel size="sm">Talentrah credits</EyebrowLabel>
        </h2>
        <h3 className="mt-3 font-display text-[28px]">{`Your balance: ${balance} credits`}</h3>
        <p className="mb-3 text-[14.5px] text-ink-soft">Credits pay for the actions below, after any free allowance. Prices are per use.</p>
        <CreditPriceList passActive={split.leading !== null} />
      </section>
    </>
  );
}
