import "server-only";
import { Resend } from "resend";

/**
 * Shared Resend client for transactional/notification email — currently
 * just the Contact form (src/lib/contact/actions.ts). Returns null rather
 * than throwing when unconfigured, since the contact form has a real
 * fallback (the mailto link on the page itself still works) — callers
 * decide what "no client" means for them instead of a hard crash.
 */
export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

/** Inbox the Contact form (and any future transactional notices) send to. */
export function getContactRecipient(): string {
  return process.env.CONTACT_EMAIL_TO || "support@talentrah.com";
}
