/**
 * The email address the sign-in page offers back as "Continue as <email>" (LOGIN-REMEMBERED-ACCOUNT-1).
 *
 * A convenience, and only that. It changes nothing about how anyone is authenticated: it is a string in this browser's localStorage that
 * pre-fills the Email field. What is stored, and what is not:
 *   - ONE value, an email address, under ONE key. Never a password, a token, a session id or a role.
 *   - Written only after a successful email sign-in (see LoginForm); never after Google, never after a failed attempt.
 *   - Sign-out does not clear it, that is the point. "Use another account" does.
 *
 * Every access is wrapped, because localStorage can throw on read, on write, or on merely touching `globalThis.localStorage` (blocked site
 * data, some private windows, a sandboxed iframe). In every such case this behaves as if nothing were stored, which is exactly how the
 * sign-in page behaved before this existed.
 *
 * The stored value is also checked on the way OUT, not only the way in: localStorage is writable by anything running on this origin and by
 * the person at the keyboard, so a value that is not shaped like an email is treated as absent rather than rendered.
 */

export const REMEMBERED_EMAIL_KEY = "talentrah.lastEmail";

/** RFC 5321's limit on a whole address. */
const MAX_EMAIL_LENGTH = 254;

/**
 * Deliberately plain: something, an @, something, a dot, something, with none of whitespace, angle brackets, quotes, ampersands, semicolons or
 * backslashes anywhere. That excludes markup and attribute breakouts by construction. It is not an address validator, and does not try to be;
 * the sign-in action does the real validation. The card renders the value as an escaped React text node as well, so this is a second wall.
 */
const PLAIN_EMAIL = /^[^\s@<>"'`&;\\()[\]{},:]+@[^\s@<>"'`&;\\()[\]{},:]+\.[^\s@<>"'`&;\\()[\]{},:]+$/;

export function isPlainEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_EMAIL_LENGTH && PLAIN_EMAIL.test(value);
}

/** The remembered email, or null when nothing valid is stored or storage is unavailable. Never throws. */
export function readRememberedEmail(): string | null {
  try {
    const value = globalThis.localStorage.getItem(REMEMBERED_EMAIL_KEY);
    return isPlainEmail(value) ? value : null;
  } catch {
    return null;
  }
}

/** Remember this email. Ignores anything that is not a plain email, and never throws. */
export function writeRememberedEmail(email: string): void {
  const trimmed = typeof email === "string" ? email.trim() : "";
  if (!isPlainEmail(trimmed)) return;
  try {
    globalThis.localStorage.setItem(REMEMBERED_EMAIL_KEY, trimmed);
  } catch {
    // Storage blocked or full: the page behaves as it always did.
  }
}

/** Forget the remembered email ("Use another account"). Never throws. */
export function clearRememberedEmail(): void {
  try {
    globalThis.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
  } catch {
    // Nothing to clear if storage cannot be reached.
  }
}

/**
 * A fingerprint of Supabase's auth cookie(s) in `document.cookie`, or "" when there are none. Used only to COMPARE two moments (before a
 * sign-in is submitted, and when the form goes away): a changed, non-empty fingerprint means the server set a session while the form was
 * waiting for it. The cookie's contents are never stored, logged or sent anywhere; they are read once for this equality check.
 */
export function authCookieSignature(cookieString?: string): string {
  try {
    const raw = cookieString ?? document.cookie;
    return raw
      .split(";")
      .map((c) => c.trim())
      .filter((c) => /^sb-[^=]*-auth-token(\.\d+)?=/.test(c))
      .sort()
      .join(";");
  } catch {
    return "";
  }
}
