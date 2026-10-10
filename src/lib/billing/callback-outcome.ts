import type { FulfillResult } from "@/lib/billing/fulfill";

/**
 * What a checkout callback page does with fulfillPayment's answer. ONE exhaustive mapping, so a status added to FulfillResult later fails the type check here instead of falling through
 * to "Something didn't go through" on four separate pages (the way "processing" would have): the `never` assignment below is a compile error until the new status is placed.
 *
 *   paid        the money is in and the product is granted (or was already): go to the success page.
 *   processing  Paystack has not finished the payment (slow rail, open checkout): say so, do not call it a failure.
 *   failed      Paystack says it failed or was reversed, or the amount did not match: nothing was granted.
 *   error       we could not tell (no such payment for this user, a payer that no longer exists): the generic "contact support" page.
 */
export type CallbackOutcome = "paid" | "processing" | "failed" | "error";

export function callbackOutcome(status: FulfillResult["status"]): CallbackOutcome {
  switch (status) {
    case "success":
    case "already_processed":
      return "paid";
    case "processing":
      return "processing";
    case "failed":
      return "failed";
    case "not_found":
    case "needs_refund":
      return "error";
    default: {
      const unplaced: never = status;
      return unplaced;
    }
  }
}
