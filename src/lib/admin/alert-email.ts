import "server-only";
import { getResendClient } from "@/lib/resend/client";

/**
 * Email the operator (send-502). The recipient is `ADMIN_ALERT_EMAIL`, read from the environment and never committed: this
 * repo is public.
 *
 * It NEVER throws. The caller is payment fulfilment, and a throw there, before the transaction is marked success, would make
 * Paystack's webhook retry a payment that was already handled. An alert that cannot be sent is logged loudly and the admin ops
 * badge is the fallback signal. The recipient address is not written to the log either.
 */
export async function sendAdminAlert(message: { subject: string; text: string }): Promise<{ sent: true } | { sent: false; reason: string }> {
  const to = process.env.ADMIN_ALERT_EMAIL?.trim();
  if (!to) {
    const reason = "ADMIN_ALERT_EMAIL is not set";
    console.error(`[admin-alert] NOT SENT (${reason}). Subject: ${message.subject}. The admin ops badge still shows it.`);
    return { sent: false, reason };
  }
  try {
    const resend = getResendClient();
    if (!resend) {
      const reason = "RESEND_API_KEY is not set";
      console.error(`[admin-alert] NOT SENT (${reason}). Subject: ${message.subject}. The admin ops badge still shows it.`);
      return { sent: false, reason };
    }
    const { error } = await resend.emails.send({
      from: "Talentrah alerts <farah@talentrah.com>",
      to,
      subject: message.subject,
      text: message.text,
    });
    if (error) {
      const reason = `the mail provider refused it: ${error.message}`;
      console.error(`[admin-alert] NOT SENT (${reason}). Subject: ${message.subject}.`);
      return { sent: false, reason };
    }
    return { sent: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[admin-alert] NOT SENT (${reason}). Subject: ${message.subject}.`);
    return { sent: false, reason };
  }
}
