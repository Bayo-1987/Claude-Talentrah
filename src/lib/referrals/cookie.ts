/**
 * The referral-capture cookie's name and scope, and nothing else.
 *
 * Split out from wherever the capture logic itself lives, same reason
 * `src/lib/admin/cookie.ts` is split from session.ts: `src/proxy.ts` needs
 * the name and must not pull in anything heavier than it already imports.
 *
 * PATH IS `/`, deliberately — unlike the admin cookie. A referral link can
 * land on any public page (a scholarship, eventually a job), and the visitor
 * has to be able to browse anywhere before signing up without losing it.
 *
 * 30-DAY TTL: long enough that "saw it in a WhatsApp group, signed up next
 * week" still attributes correctly, short enough that a stale cookie from a
 * link nobody acted on doesn't attribute a signup to a share from months ago.
 */
export const REFERRAL_COOKIE = "talentrah_ref";
export const REFERRAL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Exactly `generate_referral_code()`'s own shape (0000): 8 hex chars, uppercased. Checked before ever touching the database. */
export const REFERRAL_CODE_PATTERN = /^[0-9A-F]{8}$/i;
