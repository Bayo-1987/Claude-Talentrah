import { emailSchema } from "./schemas";
import { safeRedirectTo } from "./redirect-to";

/**
 * The value of the cookie that carries a person from the signup form to the code page (S1-101), and the helpers the page needs. Pure: nothing here reads or
 * writes a cookie (src/lib/auth/signup-pending.ts does), so it can be tested and imported anywhere.
 *
 * WHY A COOKIE. The address must reach the code page without ever being in a URL (standing rule: no personal data in URLs). The signup action sets this
 * httpOnly cookie and redirects to a bare /signup/check-email; the page and the actions read it on the server. The page never puts the full address in what
 * it sends to the browser: it shows the masked form.
 *
 * NOT A SECRET, NOT SIGNED. Whoever holds the cookie is the person who typed the address (or someone who edited their own cookie). All it can do is make
 * THEIR OWN resend and attempts target that address, and both are limited per address and per IP exactly as before. Everything read back is re-validated:
 * the address with the same schema as the signup form, the destination with safeRedirectTo.
 */
export const SIGNUP_PENDING_COOKIE = "tr_signup_pending";
/** One hour: longer than the code (15 minutes once the Supabase expiry is 900 seconds), so "resend" still works for someone whose code has expired. */
export const SIGNUP_PENDING_MAX_AGE_SECONDS = 60 * 60;
/** How long after a code is sent before another can be asked for. Shown in the UI, and enforced by the resend action. */
export const CODE_RESEND_COOLDOWN_SECONDS = 60;

const MAX_ENCODED_LENGTH = 2000;

export interface SignupPending {
  email: string;
  /** A same-site path to carry through onboarding, or "". */
  redirectTo: string;
  /** Milliseconds since the epoch when the code was last sent (signup, or a resend). */
  issuedAt: number;
}

export function encodeSignupPending(p: SignupPending): string {
  return Buffer.from(JSON.stringify({ e: p.email, r: p.redirectTo, t: p.issuedAt })).toString("base64url");
}

export function decodeSignupPending(raw: string | undefined): SignupPending | null {
  if (!raw || raw.length > MAX_ENCODED_LENGTH) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { e, r, t } = parsed as Record<string, unknown>;
    if (typeof e !== "string" || typeof r !== "string" || typeof t !== "number" || !Number.isFinite(t)) return null;
    if (!emailSchema.safeParse(e).success) return null;
    return { email: e, redirectTo: safeRedirectTo(r, ""), issuedAt: t };
  } catch {
    return null;
  }
}

/** "j••••@example.com": the first character, four dots whatever the length, and the whole domain. The length of the name is not shown. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "••••";
  return `${email[0]}••••${email.slice(at)}`;
}

/** Whole seconds until another code may be asked for; 60 right after one is sent, 0 once a minute has passed. A clock set ahead never gives more than 60. */
export function cooldownSecondsLeft(issuedAt: number, now: number): number {
  const elapsed = now - issuedAt;
  if (elapsed < 0) return CODE_RESEND_COOLDOWN_SECONDS;
  return Math.max(0, Math.min(CODE_RESEND_COOLDOWN_SECONDS, Math.ceil((CODE_RESEND_COOLDOWN_SECONDS * 1000 - elapsed) / 1000)));
}
