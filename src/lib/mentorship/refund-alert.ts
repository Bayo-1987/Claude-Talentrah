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

/**
 * A SECOND successful payment arrived for a mentor session that an earlier payment had already settled (the buyer paid two references for one booking). Nothing is delivered for the second
 * one, so a person has to refund it in Paystack. Same two best-effort signals as above, neither able to throw: a loud log line and an email to ADMIN_ALERT_EMAIL. The payment is recorded as
 * `needs_refund` in payment_transactions and therefore visible in the finance status buckets.
 */
export async function alertDuplicateSessionPayment(args: { reference: string; amountNgn: number; sessionId: string }): Promise<void> {
  const amount = `₦${args.amountNgn.toLocaleString("en-NG")}`;
  console.error(
    `[fulfill] NEEDS REFUND: payment ${args.reference} (${amount}) is a SECOND payment for mentor session ${args.sessionId}, which an earlier payment already paid for. ` +
      `It is recorded as needs_refund in payment_transactions. Refund the transaction in Paystack.`,
  );
  try {
    await sendAdminAlert({
      subject: `Refund needed: ${amount} paid twice for one mentor session`,
      text: [
        `A mentee paid twice for the same mentor session. The first payment booked it; the second delivered nothing.`,
        ``,
        `Amount:                     ${amount}`,
        `Paystack reference (second): ${args.reference}`,
        `Session:                    ${args.sessionId}`,
        ``,
        `What to do: refund the charge in the Paystack dashboard using the reference above. The transaction is recorded as needs_refund; the first payment and the session are untouched.`,
      ].join("\n"),
    });
  } catch (err) {
    console.error(`[fulfill] could not send the duplicate-payment refund alert: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * A Talent Directory subscription payment was verified with Paystack but there is nothing to activate: another subscription already holds the
 * organisation's one active slot (it is running, or it is waiting on its automatic renewal), or the pending row or its plan is gone
 * (activate_talent_directory_subscription, 0228, returned activated = false for a reason other than "already activated"). The money is taken for
 * something that will not be delivered, so a person has to refund it in Paystack. Same two best-effort signals as above, neither able to
 * throw. The transaction is `needs_refund` in payment_transactions and therefore visible in the finance status buckets.
 */
export async function alertSubscriptionPaymentNeedsRefund(args: { reference: string; amountNgn: number; reason: string }): Promise<void> {
  const amount = `₦${args.amountNgn.toLocaleString("en-NG")}`;
  console.error(
    `[fulfill] NEEDS REFUND: Talent Directory subscription payment ${args.reference} (${amount}) could not be activated (${args.reason}). ` +
      `It is recorded as needs_refund in payment_transactions. Refund the transaction in Paystack.`,
  );
  try {
    await sendAdminAlert({
      subject: `Refund needed: ${amount} Talent Directory payment`,
      text: [
        `A Talent Directory subscription payment was confirmed but could not be activated (${args.reason}).`,
        ``,
        `Amount:             ${amount}`,
        `Paystack reference: ${args.reference}`,
        ``,
        `What to do: refund the charge in the Paystack dashboard using the reference above. The transaction is recorded as needs_refund.`,
      ].join("\n"),
    });
  } catch (err) {
    console.error(`[fulfill] could not send the subscription refund alert: ${err instanceof Error ? err.message : String(err)}`);
  }
}
