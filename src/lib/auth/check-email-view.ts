import "server-only";
import { readSignupPending } from "./signup-pending";
import { cooldownSecondsLeft, maskEmail } from "./signup-pending-codec";
import { webmailUrlFor } from "./email-provider";

export interface CheckEmailView {
  /** "j••••@example.com". The full address is never sent to the page. */
  maskedEmail: string;
  /** Seconds before "Resend code" is available when the page first loads. */
  cooldownSeconds: number;
  /** A link to the person's mail provider, or null. Built from the domain only: it carries no address. */
  webmailUrl: string | null;
}

/** What /signup/check-email shows, from the pending-signup cookie, or null when there is none (it ended or was never set). */
export async function getCheckEmailView(): Promise<CheckEmailView | null> {
  const pending = await readSignupPending();
  if (!pending) return null;
  return {
    maskedEmail: maskEmail(pending.email),
    cooldownSeconds: cooldownSecondsLeft(pending.issuedAt, Date.now()),
    webmailUrl: webmailUrlFor(pending.email),
  };
}
