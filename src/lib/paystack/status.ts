/**
 * What a Paystack verify status means for a payment we are waiting on. ONE place, used by the checkout fulfilment (src/lib/billing/fulfill.ts) and both recurring-renewal jobs, so the rule
 * "only these are the end of a payment that never succeeded" cannot drift between them.
 *
 * Terminal failure: "failed" and "reversed" (a refund or a chargeback). Everything else that is not "success" is NOT a failure, however it is named: "abandoned" (the customer has not completed it,
 * and the link still works), "pending" and "ongoing" (in progress), "processing" (pending, for direct debit), "queued" (bulk charge). A status nobody has seen before is treated the same way:
 * waiting on a payment that never completes costs a row that stays pending, while calling a payment failed that then completes costs a customer who paid and received nothing, and a fresh
 * charge on top of a first one that is still in flight bills them twice.
 */
const TERMINAL_FAILURE: ReadonlySet<string> = new Set(["failed", "reversed"]);
const KNOWN_NON_TERMINAL: ReadonlySet<string> = new Set(["abandoned", "pending", "ongoing", "processing", "queued"]);

export function isTerminalPaystackFailure(status: string): boolean {
  return TERMINAL_FAILURE.has(status);
}

/** A non-success answer that is not a known one: the caller treats it as unfinished, and logs it once so somebody learns the new word. */
export function isUnrecognisedPaystackStatus(status: string): boolean {
  return status !== "success" && !TERMINAL_FAILURE.has(status) && !KNOWN_NON_TERMINAL.has(status);
}
