import "server-only";
import { buildPurchaseReceiptEmail } from "@/lib/billing/receipt-email";
import { getResendClient } from "@/lib/resend/client";

/**
 * Returns a function that sends a purchase receipt email through the (account-deletion-guarded) Resend client, or null when Resend is not configured.
 * (The client is obtained here, in the same file that sends, because tests/email/every-sender-uses-the-guarded-client.test.ts requires it.)
 *
 * The EMAIL is built by buildPurchaseReceiptEmail, the same builder the purchase itself uses (src/lib/billing/fulfill.ts), so a resent
 * receipt cannot drift from the original. This file deliberately does not touch fulfill.ts: that is the money path, and its own private
 * sender stays exactly as it is. Returns true only when Resend accepted the message; an error object or a thrown error is false, so the
 * caller can say so rather than pretend.
 */
export function getReceiptMailer():
  | ((args: { to: string; greeting: string; productName: string; productType: string; amountNgn: number; reference: string }) => Promise<boolean>)
  | null {
  const resend = getResendClient();
  if (!resend) return null;
  return async (args) => {
    const email = buildPurchaseReceiptEmail({
      greeting: args.greeting,
      productName: args.productName,
      productType: args.productType,
      amountNgn: args.amountNgn,
      reference: args.reference,
    });
    try {
      const { error } = await resend.emails.send({
        from: "Talentrah <billing@talentrah.com>",
        to: args.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
      return !error;
    } catch {
      return false;
    }
  };
}
