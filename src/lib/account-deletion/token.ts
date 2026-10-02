import { createHash, randomBytes } from "node:crypto";

/**
 * ACCT-1 — the emailed confirm link's token, and the two numbers the owner decided.
 *
 * The token is the secret in an emailed link, so the database keeps only its sha256 (`account_deletions.token_hash`): a read of that table cannot be
 * turned into a working link. 32 random bytes from the system generator, shown as 64 hex characters, so a malformed value can be refused with a
 * pattern check before it costs a database call.
 */

/** The confirm link works for one hour. Enforced in SQL (`token_expires_at`); this constant is what the email and the page say. */
export const DELETION_LINK_TTL_MINUTES = 60;

/** Signing in again inside this window offers to restore the account. Enforced in SQL (`hard_delete_after`); this is what the copy says. */
export const RESTORE_WINDOW_DAYS = 30;

/** The phrase typed to ask for deletion (owner's decision). */
export const DELETION_CONFIRM_PHRASE = "delete my account";

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function hashDeletionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateDeletionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashDeletionToken(token) };
}

export function isWellFormedDeletionToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

/** Case and surrounding space do not matter; the words do. */
export function confirmPhraseMatches(input: unknown): boolean {
  return typeof input === "string" && input.trim().toLowerCase() === DELETION_CONFIRM_PHRASE;
}
