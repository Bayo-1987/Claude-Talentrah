/**
 * The one way an admin Finance screen turns a stored payment amount into text.
 *
 * `payment_transactions.amount` is WHOLE NAIRA, not kobo: the writers store the price in naira (`priceNgn`, `plan.price_ngn`) and the member's billing page prints it straight after a ₦. Nothing
 * here converts it. Two screens used to divide by 100 as if it were a minor unit, so a N2,500 payment read N25 (and the ad-wallet figure, which is already whole naira, was multiplied by 100 first
 * to cancel it). Format through this and the unit cannot drift between screens.
 */
export function formatWholeAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}
