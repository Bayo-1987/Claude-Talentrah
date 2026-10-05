import { NairaAmount } from "@/components/ui";
import { receiptNumber } from "@/lib/billing/receipt-number";
import type { ActivityRow } from "@/lib/billing/billing-view";
import { PaymentReference } from "@/components/billing/payment-reference";
import { Button } from "@/components/ui";
import { resendReceiptAction } from "@/lib/billing/receipt-actions";

/**
 * Recent purchases as a real table (a caption, column headers) so a screen reader announces rows and columns.
 *
 * Only successful payments are listed, on purpose (see page.tsx): a pending row is a charge Paystack has not confirmed and a failed one is
 * not a purchase. So there is no status column: every row would say the same thing. The receipt is the short number the confirmation
 * email quotes, as text; the full Paystack reference sits under "Payment reference" for support. There is no receipt to open or download.
 */
export function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  if (rows.length === 0) {
    return <p className="text-[14px] text-ink-soft">No purchases yet.</p>;
  }
  return (
    <>
      <table className="w-full table-fixed border-collapse text-left text-[14px]">
        <caption className="sr-only">Recent activity</caption>
        <thead>
          <tr className="border-b-[1.5px] border-ink text-[11px] font-bold uppercase tracking-[0.14em] text-ink-soft">
            <th scope="col" className="w-[24%] py-2 pr-2 font-bold @[560px]:w-[16%]">
              Date
            </th>
            <th scope="col" className="w-[32%] py-2 pr-2 font-bold @[560px]:w-[36%]">
              Item
            </th>
            <th scope="col" className="w-[18%] py-2 pr-2 font-bold @[560px]:w-[16%]">
              Price
            </th>
            <th scope="col" className="w-[26%] py-2 font-bold @[560px]:w-[32%]">
              Receipt
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line align-top">
              <td className="break-words py-3 pr-2 text-ink-soft">{r.date}</td>
              <td className="break-words py-3 pr-2">
                <span className="font-semibold text-ink">{r.item}</span>
                {r.active && (
                  <span className="ml-2 inline-block border border-ink px-2 py-px text-[11px] font-semibold uppercase tracking-[0.08em]">
                    Active
                  </span>
                )}
                {r.via && <span className="block text-[12.5px] text-ink-soft">{r.via}</span>}
              </td>
              <td className="py-3 pr-2 font-display text-[16px] text-ink">
                <NairaAmount amount={r.amount} />
              </td>
              <td className="break-words py-3 text-[12.5px] text-ink-soft">
                {r.reference ? (
                  <>
                    {/* One string, so the label and the number read as one thing. */}
                    <span className="block">{`Receipt ${receiptNumber(r.productType, r.reference)}`}</span>
                    <PaymentReference reference={r.reference} />
                    {r.resendable && (
                      <form action={resendReceiptAction.bind(null, r.id)}>
                        <Button type="submit" variant="text" size="md">
                          Email me this receipt
                        </Button>
                      </form>
                    )}
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 font-display text-[12.5px] italic text-ink-soft">Showing your ten most recent purchases.</p>
    </>
  );
}
