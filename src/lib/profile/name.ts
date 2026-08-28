/**
 * Is there actually a name here — one a human would see?
 *
 * ── The bug this exists for ───────────────────────────────────────────────
 *
 * `.trim()` is not an emptiness test for user-supplied names. It strips the
 * ECMAScript WhiteSpace production, which covers spaces, tabs, NBSP and — a
 * detail worth knowing — U+FEFF. It does NOT cover the zero-width FORMAT
 * characters, because those are Unicode category Cf, not Zs:
 *
 *     " ".trim().length            === 0   // rejected, correct
 *     "﻿".trim().length       === 0   // rejected, correct
 *     "​".trim().length       === 1   // ACCEPTED, renders as nothing
 *
 * A profile whose `first_name` is a single U+200B passes
 * `z.string().trim().min(1)`, satisfies every `first_name?.trim() ? …` guard
 * in the app, and renders as blank everywhere it is shown — the onboarding
 * greeting, the avatar initials, Farah's panel, and the Pass renewal email
 * that lands in a paying customer's inbox.
 *
 * That reopens the defect PR #21 fixed: the "no name yet" fallbacks are all
 * conditioned on a check this input walks straight through.
 *
 * ── Why a DB constraint exists as well as this ────────────────────────────
 *
 * This helper alone cannot close the hole. Migration 0030 grants
 * `update (first_name, last_name, …)` to `authenticated`, so a signed-in user
 * can PATCH the column directly through PostgREST and never execute a line of
 * this file. Verified against production with a real session: writing U+200B,
 * U+2060 — and a plain space — all returned OK.
 *
 * The real gate is therefore the CHECK constraint in migration 0045. This
 * helper is the UX half: a clear inline error beats a raw 23514 from Postgres.
 *
 * ── KEEP THIS LIST IN SYNC WITH MIGRATION 0045 ────────────────────────────
 *
 * The same rule is expressed twice — once here in JS, once as a Postgres
 * CHECK — because a regex cannot be shared across the two. They must accept
 * and reject exactly the same strings. Add a codepoint here and you must add
 * it to `0045_profile_names_visible.sql` in the same change, and vice versa.
 * Drift either way is its own bug: JS accepting what SQL rejects gives the
 * user an unexplained constraint violation; SQL accepting what JS rejects puts
 * the blank name back in the database.
 *
 * The codepoints, and why each is here:
 *   U+200B  ZERO WIDTH SPACE          Cf — not stripped by trim()
 *   U+200C  ZERO WIDTH NON-JOINER     Cf — legitimate mid-word in some
 *                                     scripts, but never a whole name alone
 *   U+200D  ZERO WIDTH JOINER         Cf — same
 *   U+2060  WORD JOINER               Cf — the non-breaking ZWSP
 *   U+180E  MONGOLIAN VOWEL SEPARATOR Cf since Unicode 6.3, so trim() stopped
 *                                     stripping it
 * `\s` covers the rest, including U+FEFF and NBSP.
 */

/** Zero-width / invisible format characters that `\s` and `.trim()` miss. */
const INVISIBLE_FORMAT_CHARS = /[​‌‍⁠᠎]/g;

/**
 * The name with invisible characters removed and edges trimmed — what a reader
 * would actually see. Returns "" when nothing visible remains.
 */
export function visibleName(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(INVISIBLE_FORMAT_CHARS, "").trim();
}

/** True when the value contains at least one character a human can see. */
export function hasVisibleName(value: string | null | undefined): boolean {
  return visibleName(value).length > 0;
}

/**
 * What to store. Collapses internal whitespace runs so "Ada  Lovelace" and
 * "Ada Lovelace" are not two different stored names — invisible characters are
 * removed first, so they cannot hold a run apart and defeat the collapse.
 */
export function normalizeName(value: string | null | undefined): string {
  return visibleName(value).replace(/\s+/g, " ");
}

/**
 * First + last as one string, or "" when the profile has neither.
 *
 * Built on visibleName so a name made of zero-width characters collapses to
 * "" here too, rather than producing a heading that renders as blank space.
 *
 * WORTH KNOWING BEFORE YOU RELY ON IT: "" is the majority answer. 26 of 36
 * production profiles have no first_name and no last_name — signup collects an
 * email and a password, and the name fields are only populated by OAuth or by
 * a later visit to Settings. Callers must render the empty case deliberately;
 * treating this as "always a name" produces a blank line, not a fallback.
 *
 * Deliberately does NOT fall back to the email's local part. Showing "ada"
 * above "ada@example.com" is the same string twice, and it asserts a name the
 * person never gave us.
 */
export function fullVisibleName(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  return [visibleName(first), visibleName(last)].filter(Boolean).join(" ");
}

/**
 * Up to two uppercase initials, or "" when there is no visible name.
 *
 * Uppercased here rather than by the caller: the source is whatever the user
 * typed, so a profile saved as "ada lovelace" rendered a lowercase "al" in a
 * circle that is styled for capitals.
 */
export function nameInitials(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  const f = visibleName(first)[0] ?? "";
  const l = visibleName(last)[0] ?? "";
  return `${f}${l}`.toUpperCase();
}
