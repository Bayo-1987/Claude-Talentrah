/**
 * The short number a person quotes for a payment (send-503, S18).
 *
 * `payment_transactions.paystack_reference` is an internal id ("credit_pack_678586c1-9f2e-4c3a-8d11-0a1b2c3d4e5f", 47 characters).
 * It used to be shown as "Receipt …", which nobody can read out over the phone. This derives "CP-678586C1" from it.
 *
 * DISPLAY ONLY. Never stored, never used to look anything up, and not guaranteed unique (eight hex characters of a UUID):
 * the full reference stays in the data and is shown under "Payment reference", and that is what support searches by.
 */

const PREFIX: Record<string, string> = {
  credit_pack: "CP",
  pass: "PS",
  ad_wallet_topup: "AW",
  mentor_session: "MS",
  talent_directory_subscription: "TD",
};

const UUID_TAIL = /([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function receiptNumber(productType: string, reference: string): string {
  const prefix = PREFIX[productType] ?? "RC";
  const uuid = UUID_TAIL.exec(reference);
  if (uuid) return `${prefix}-${uuid[1].toUpperCase()}`;
  // Not one of ours (a Paystack-generated or hand-made reference): its last eight letters or digits.
  const alnum = reference.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return `${prefix}-${alnum.slice(-8)}`;
}
