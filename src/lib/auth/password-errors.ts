import { PASSWORD_MIN_LENGTH, allPasswordNeeds, lengthNeed, listOf, passwordNeedsSentence, serverClassNeed } from "./password";

/**
 * What to tell a person whose password, or whose request, Supabase refused (S1-45).
 *
 * Supabase enforces a minimum length, required character classes and leaked-password protection (HaveIBeenPwned) on signup and password change, so
 * a request can come back refused even when the app's own check passed. Each case gets a plain sentence: never the raw code, never a generic error.
 *
 * NOTHING HERE HARD-CODES THE SERVER'S RULE. The dashboard's minimum was 6 and is moving to 8 with lowercase, uppercase and digits; the words must be
 * right before and after. So the length quoted is the number in the SERVER's message ("at least N characters"), and the classes named are the ones the
 * server's message names; only when the message carries no detail does the sentence fall back to the app's own rule (src/lib/auth/password.ts, which
 * tests/auth/weak-password-messages.test.ts pins against the declared dashboard policy and the local stack's config).
 *
 * `passwordErrorMessage` returns null for an error it does not recognise, so the caller keeps whatever handling it already had for that error.
 */
export const LEAKED_MESSAGE = "This password has appeared in a data breach. Please choose a different one.";
export const REUSED_MESSAGE = "Choose a password you haven't used on this account before.";
export const RATE_LIMITED_MESSAGE = "Too many attempts. Wait a few minutes, then try again.";

const RATE_LIMIT_CODES = new Set(["over_request_rate_limit", "over_email_send_rate_limit", "over_sms_send_rate_limit"]);

/** The minimum the server quoted ("at least N characters"), or the app's own when its message names none. */
function serverMinimumLength(message: string): number {
  const quoted = /at least (\d+) characters?/i.exec(message)?.[1];
  return quoted ? Number(quoted) : PASSWORD_MIN_LENGTH;
}

/** The classes the server's message names, in the order the app lists them. No detail in the message means every class the app's own list has. */
function listOfNeeds(): string {
  return listOf(allPasswordNeeds());
}

function serverClasses(message: string): string[] {
  const named: string[] = [];
  // The server names a class either by its alphabet (case-sensitive: "abc..." is lowercase, "ABC..." uppercase) or by a word.
  const hasUpper = /ABCDEFGHIJKLMNOPQRSTUVWXYZ/.test(message) || /upper/i.test(message);
  const hasLower = /abcdefghijklmnopqrstuvwxyz/.test(message) || /lower/i.test(message);
  const hasDigit = /0123456789|digit|number/i.test(message);
  const hasSymbol = /symbol|special|!@#\$/i.test(message);
  if (hasUpper) named.push(serverClassNeed("upper"));
  if (hasLower) named.push(serverClassNeed("lower"));
  if (hasDigit) named.push(serverClassNeed("number"));
  if (hasSymbol) named.push(serverClassNeed("symbol"));
  const found = named.filter(Boolean);
  return found.length > 0 ? found : allPasswordNeeds().slice(1);
}

/** A refusal worth a plain sentence, and whether it is about the password field itself (the rate limit is about the form, not the password). */
export interface PasswordRefusal {
  message: string;
  aboutPassword: boolean;
}

interface MaybeAuthError {
  code?: unknown;
  name?: unknown;
  message?: unknown;
  reasons?: unknown;
  status?: unknown;
}

export function passwordErrorMessage(error: unknown): string | null {
  return passwordRefusal(error)?.message ?? null;
}

export function passwordRefusal(error: unknown): PasswordRefusal | null {
  if (!error || typeof error !== "object") return null;
  const e = error as MaybeAuthError;
  const message = typeof e.message === "string" ? e.message : "";

  if (e.code === "same_password") return { message: REUSED_MESSAGE, aboutPassword: true };
  if ((typeof e.code === "string" && RATE_LIMIT_CODES.has(e.code)) || e.status === 429) return { message: RATE_LIMITED_MESSAGE, aboutPassword: false };

  const isWeak = e.code === "weak_password" || e.name === "AuthWeakPasswordError" || Array.isArray(e.reasons);
  if (!isWeak) return null;

  const reasons = Array.isArray(e.reasons) ? e.reasons.filter((r): r is string => typeof r === "string") : [];

  // A gateway can drop `reasons`; only then is the message read: Supabase's own sentence for a leaked password is "...known to be weak...".
  if (reasons.includes("pwned") || (reasons.length === 0 && /known to be weak|pwned|breach/i.test(message))) return { message: LEAKED_MESSAGE, aboutPassword: true };

  const needs: string[] = [];
  if (reasons.includes("length")) needs.push(lengthNeed(serverMinimumLength(message)));
  if (reasons.includes("characters")) needs.push(...serverClasses(message));
  if (needs.length > 0) return { message: passwordNeedsSentence(needs), aboutPassword: true };

  return { message: `That password is too easy to guess. Choose one with ${listOfNeeds()}.`, aboutPassword: true };
}
