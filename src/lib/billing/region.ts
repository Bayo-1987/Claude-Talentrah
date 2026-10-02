/**
 * What billing means for an account, in words (send-503, S18).
 *
 * Read from the real path, not assumed: initiatePurchaseAction (actions.ts) creates every purchase in BILLING_CURRENCY and
 * sends it to Paystack for EVERY account. It never reads `profiles.market_segment`, and there is no Stripe or USD path. So the
 * region wording depends on the country only, and both variants say "naira". tests/billing/billing-region.test.ts reads
 * actions.ts and fails if a segment-dependent path, another processor or another currency appears, so the copy cannot drift
 * from the code unnoticed.
 */

/** The one currency initiatePurchaseAction charges. The copy below names it; the action imports it. */
export const BILLING_CURRENCY = "NGN" as const;

export function billingRegionLabel(country: string | null | undefined): string {
  const c = country?.trim();
  if (!c) return "Billed in naira (₦)";
  if (c === "Nigeria") return "Nigeria — billed in naira (₦)";
  // Paystack's bank, bank-transfer and USSD channels are Nigerian rails; away from Nigeria a card is the one that works.
  return "Outside Nigeria — billed in naira (₦) by card";
}
