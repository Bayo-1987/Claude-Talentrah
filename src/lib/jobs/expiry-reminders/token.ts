import { createHash, randomBytes } from "node:crypto";

/**
 * The single-use token behind an Extend link.
 *
 * 32 random bytes, base64url: 43 characters, 256 bits, unguessable. Only its sha256 is stored
 * (job_expiry_reminders.token_hash, migration 0205), so reading the table never yields a working link; the raw token
 * exists in the email and nowhere else. A plain hash (no salt, no HMAC key) is right for a 256-bit random secret:
 * there is nothing to brute-force, and a lookup by hash needs the hash to be deterministic.
 */
export const EXTEND_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashExtendToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateExtendToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashExtendToken(token) };
}

/** Cheap shape check, run before any database call: anything else cannot be a token we issued. */
export function isWellFormedExtendToken(token: unknown): token is string {
  return typeof token === "string" && EXTEND_TOKEN_PATTERN.test(token);
}
