import "server-only";
import { randomUUID } from "node:crypto";
import { massSendIdentity } from "@/lib/email/mass-send-config";
import { createResendMassProvider } from "@/lib/email/mass-send-provider";
import { buildMassEmail, streamFor } from "@/lib/email/mass-send";
import { isFeatureEnabled } from "@/lib/flags/read";
import { NOTIFICATION_FLAGS, type AdminMessageRow } from "@/lib/notifications/contract";
import { inboxEnabled } from "@/lib/notifications/inbox/enabled";

/**
 * A test send: ONE email, to the signed-in operator's own address, and nobody else's.
 *
 * It is not a send of the message. It takes no claim and so counts toward neither limit, it carries a fresh random unsubscribe token on every call (the link in a test copy does nothing, and the
 * subject says it is a test), and it needs the same switches a real email needs. The result is a sentence; the operator's address is never written to a log or returned.
 */
export async function sendTestEmail(message: Pick<AdminMessageRow, "id" | "kind" | "title" | "body" | "link_path" | "channels" | "consent_line">, operatorEmail: string): Promise<string> {
  if (!message.channels.includes("email")) return "Recorded. This message does not use email, so there is no email to send you.";
  // The master switch is read only through inboxEnabled(), the one reader tests/notifications/bell-flag-once.test.ts allows.
  if (!(await inboxEnabled()) || !(await isFeatureEnabled(NOTIFICATION_FLAGS.adminEmail))) {
    return "Admin email is switched off, so no test email was sent.";
  }
  const identity = massSendIdentity();
  if (!identity) return "No test email was sent: no sender address is configured.";
  const stream = streamFor(message.kind);
  const email = buildMassEmail({
    identity,
    to: operatorEmail,
    subject: `[Test] ${message.title}`,
    body: message.body,
    linkPath: message.link_path,
    stream,
    unsubscribeToken: randomUUID(), // a fresh throwaway per call: it matches no stored token, so the link in a test copy does nothing
    consentLine: message.consent_line ?? (stream === "promotions" ? "Test copy." : null),
    firstName: null,
  });
  const answer = await createResendMassProvider().sendBatch([email], { idempotencyKey: randomUUID() });
  if (answer.kind === "ok") return "Test sent to your own address. The unsubscribe link in a test copy does nothing.";
  return "The test email could not be sent. Nothing went to anyone else.";
}
