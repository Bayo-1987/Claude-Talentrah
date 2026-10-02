import "server-only";
import { sendAdminAlert } from "@/lib/admin/alert-email";

/**
 * A mentor payment landed on a booking that had already lapsed and whose slot could not be restored (0203's
 * settle_late_mentor_payment returned `needs_refund`). The money is held for a session that will not happen, so a person has
 * to refund it in Paystack. Two signals, both best-effort and neither able to throw: a loud log line, and an email to
 * ADMIN_ALERT_EMAIL. The admin ops badge (which counts these) is the one that does not depend on either.
 */
export async function alertPaymentNeedsRefund(args: { reference: string; amountNgn: number; sessionId: string }): Promise<void> {
  const amount = `₦${args.amountNgn.toLocaleString("en-NG")}`;
  console.error(
    `[fulfill] NEEDS REFUND: payment ${args.reference} (${amount}) landed on mentor session ${args.sessionId}, which had ` +
      `already lapsed and whose slot could not be restored. The session is marked payment_needs_refund and counted on the ` +
      `admin ops badge. Refund the transaction in Paystack.`,
  );
  try {
    await sendAdminAlert({
      subject: `Refund needed: ${amount} mentor payment`,
      text: [
        `A mentor payment arrived after its booking had lapsed, and the slot could not be restored.`,
        `The mentee has paid for a session that will not happen.`,
        ``,
        `Amount:             ${amount}`,
        `Paystack reference: ${args.reference}`,
        `Session:            ${args.sessionId}`,
        ``,
        `What to do: open /admin/ops, find the entry under "Mentor payments to refund", refund the charge in the Paystack`,
        `dashboard using the reference above, then mark it resolved there.`,
      ].join("\n"),
    });
  } catch (err) {
    console.error(`[fulfill] could not send the refund alert: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * A payment verified with Paystack arrived for a user whose account no longer exists (migration 0209 detaches payments from a deleted user
 * instead of deleting them). There is nobody to grant it to, so a person has to refund it in Paystack. Same two best-effort signals as above,
 * neither able to throw: a loud log line and an email to ADMIN_ALERT_EMAIL. The transaction is `needs_refund` in payment_transactions and
 * therefore visible in the finance status buckets.
 */
export async function alertDeletedUserPayment(args: { reference: string; amountNgn: number; productType: string }): Promise<void> {
  const amount = `₦${args.amountNgn.toLocaleString("en-NG")}`;
  console.error(
    `[fulfill] NEEDS REFUND: payment ${args.reference} (${amount}, ${args.productType}) arrived for a user whose account was deleted. ` +
      `It is recorded as needs_refund in payment_transactions. Refund the transaction in Paystack.`,
  );
  try {
    await sendAdminAlert({
      subject: `Refund needed: ${amount} payment for a deleted account`,
      text: [
        `A payment arrived for an account that has been deleted, so there is nobody to credit.`,
        ``,
        `Amount:             ${amount}`,
        `Product:            ${args.productType}`,
        `Paystack reference: ${args.reference}`,
        ``,
        `What to do: refund the charge in the Paystack dashboard using the reference above. The transaction is recorded as needs_refund.`,
      ].join("\n"),
    });
  } catch (err) {
    console.error(`[fulfill] could not send the deleted-user refund alert: ${err instanceof Error ? err.message : String(err)}`);
  }
}
