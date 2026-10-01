import { emailParagraph, escEmail, renderBrandedEmail } from "@/lib/email/layout";
import { absoluteUrl } from "@/lib/seo/site";
import { receiptNumber } from "@/lib/billing/receipt-number";

/**
 * The purchase confirmation email, built without sending (send-503, S18) so it can be tested without a database.
 *
 * "Receipt number" is the short number a person quotes ("CP-678586C1"); the full Paystack reference sits under "Payment reference"
 * for support. The email used to print the internal reference as the receipt number.
 */
export function buildPurchaseReceiptEmail(args: {
  greeting: string;
  productName: string;
  productType: string;
  amountNgn: number;
  reference: string;
}): { subject: string; text: string; html: string } {
  const { greeting, productName, reference } = args;
  const amountText = `₦${args.amountNgn.toLocaleString("en-NG")}`;
  const receipt = receiptNumber(args.productType, reference);
  const billingUrl = absoluteUrl("/billing");

  const label = "padding:4px 0;font:400 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#5a4a3f;";
  const value = "padding:4px 0;font:600 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#2b2119;text-align:right;";
  const small = "padding:4px 0;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#5a4a3f;text-align:right;word-break:break-all;";
  const receiptBox = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
      <tr><td style="${label}">What you bought</td>
          <td style="${value}">${escEmail(productName)}</td></tr>
      <tr><td style="${label}">Amount</td>
          <td style="${value}">${escEmail(amountText)}</td></tr>
      <tr><td style="${label}">Receipt number</td>
          <td style="${value}">${escEmail(receipt)}</td></tr>
      <tr><td style="${label}">Payment reference</td>
          <td style="${small}">${escEmail(reference)}</td></tr>
    </table>`;

  return {
    subject: `Your Talentrah purchase — ${productName}`,
    text:
      `Hi${greeting ? ` ${greeting}` : ""},\n\n` +
      `Thanks — your payment went through.\n\n` +
      `What you bought: ${productName}\n` +
      `Amount: ${amountText}\n` +
      `Receipt number: ${receipt}\n` +
      `Payment reference: ${reference}\n\n` +
      `Quote the receipt number if you ever need to ask us about this payment. ` +
      `You can see all your purchases on your Billing page.\n\n— Talentrah`,
    html: renderBrandedEmail({
      bodyHtml: [
        emailParagraph(`Hi${greeting ? ` ${escEmail(greeting)}` : ""},`),
        emailParagraph("Thanks — your payment went through."),
        receiptBox,
        emailParagraph(
          `Quote the receipt number if you ever need to ask us about this payment. You can see all your purchases on your <a href="${escEmail(billingUrl)}" style="color:#6b4a3a;">Billing page</a>.`,
        ),
        emailParagraph("— Talentrah"),
      ].join("\n"),
    }),
  };
}
