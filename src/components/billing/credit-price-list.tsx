import { creditPriceList } from "@/lib/credits/price-list";
import { priceText } from "@/lib/credits/price-labels";
import { PASS_COVERAGE_NOTE, coveredByPass } from "@/lib/passes/pass-coverage";

/**
 * Everything credits pay for, with its price, in two columns on a wide screen and one on a phone.
 *
 * Built from creditPriceList() (CREDIT_COSTS through the priced() helper every spender button uses), never retyped. For a holder of a
 * running Pass, an action the Pass covers (PASS_COVERAGE, cross-checked against the gates by tests/passes/pass-coverage-list.test.ts)
 * reads "included with your Pass" and shows NO price: the rule in src/lib/credits/price-labels.ts, that a covered user is never shown a
 * price. Every other row, and every row for someone with no Pass, shows its price.
 *
 * The label and the price are separate boxes so they can sit at opposite ends of the row; a visually hidden " · " between them keeps the
 * text a screen reader (and tests/billing/billing-page-copy.test.tsx) reads as "Tailor a resume · 20 credits".
 */
export function CreditPriceList({ passActive }: { passActive: boolean }) {
  return (
    <ul className="grid list-none grid-cols-1 gap-x-12 p-0 @[560px]:grid-cols-2">
      {creditPriceList().map((entry) => {
        const covered = passActive && coveredByPass(entry.key);
        const note = covered ? PASS_COVERAGE_NOTE[entry.key] : undefined;
        return (
          <li
            key={entry.key}
            data-action={entry.key}
            className="flex items-baseline justify-between gap-4 border-b border-line py-3 text-[14px]"
          >
            <span>{entry.label}</span>
            <span className="sr-only"> · </span>
            {covered ? (
              <span className="text-right">
                <span className="inline-block whitespace-nowrap border border-ink px-2 py-px text-[12px] font-semibold first-letter:uppercase">
                  {priceText({ cost: entry.cost, passCovered: true })}
                </span>
                {note && <span className="block text-[12.5px] text-ink-soft">{note}</span>}
              </span>
            ) : (
              <span className="whitespace-nowrap font-semibold tabular-nums">{priceText({ cost: entry.cost })}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
