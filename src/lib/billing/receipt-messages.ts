import { RATE_LIMITS } from "@/lib/api/rate-limit";
import type { ReceiptOutcome } from "@/lib/billing/receipt-actions";

/**
 * What the billing page says for each outcome "Email me this receipt" redirects back with (`?receipt=<outcome>`). One place, so the page
 * and the tests that pin the sentences read the same text. The limit in the "limited" sentence is the constant the action enforces.
 */
export const RECEIPT_MESSAGE: Record<ReceiptOutcome, string> = {
  sent: "Receipt sent to your email.",
  limited: `You've sent ${RATE_LIMITS.receiptResend.limit} receipt emails in the last 24 hours. Try again later.`,
  unavailable: "Receipt email isn't available right now.",
  failed: "We couldn't send that receipt just now. Try again in a little while.",
  not_found: "We couldn't find that purchase.",
};
