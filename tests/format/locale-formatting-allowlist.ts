/**
 * The date-formatting ratchet's ALLOWLIST (send-499): the direct `toLocale*String` / `Intl.DateTimeFormat` calls still
 * allowed outside src/lib/format/datetime.ts, per file. It starts as today's violations (57 when the ratchet was written)
 * and ONLY EVER SHRINKS: converting a site to the formatter lowers the count here and in ALLOWLIST_CEILING in the same
 * commit. tests/format/no-direct-locale-formatting.test.ts holds the allowlist exactly equal to the real hits, so a new
 * violation fails, a converted site that is still listed fails, and the ceiling can never exceed what it started at.
 *
 * Why these four: the mentorship sessions pages. The PR that makes "Upcoming" mean paid-and-upcoming rewrites those exact
 * lines, so converting them here would conflict with it; they convert right after it merges, and these entries are deleted.
 */
export const ALLOWLIST: Record<string, number> = {
  "src/app/(app)/mentorship/sessions/page.tsx": 2,
  "src/app/(app)/mentorship/sessions/mentor/page.tsx": 2,
};

/** Must equal the sum of ALLOWLIST. Lower it with every conversion; raising it is a visible, reviewed act. */
export const ALLOWLIST_CEILING = 4;

/** How many violations existed when the ratchet was introduced. Never changes: the ceiling may not exceed it. */
export const INITIAL_VIOLATIONS = 57;
