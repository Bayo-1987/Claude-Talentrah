/**
 * The date-formatting ratchet's ALLOWLIST (send-499): the direct `toLocale*String` / `Intl.DateTimeFormat` calls still
 * allowed outside src/lib/format/datetime.ts, per file. It starts as today's violations (57 when the ratchet was written)
 * and ONLY EVER SHRINKS: converting a site to the formatter lowers the count here and in ALLOWLIST_CEILING in the same
 * commit. tests/format/no-direct-locale-formatting.test.ts holds the allowlist exactly equal to the real hits, so a new
 * violation fails, a converted site that is still listed fails, and the ceiling can never exceed what it started at.
 *
 * It is EMPTY now: the last four entries were the mentorship sessions pages, which the "Upcoming means paid and upcoming" PR (#633)
 * rewrote; they were converted right after it merged and their entries deleted. The structure stays so that a future, deliberate
 * exception is a visible, reviewed addition to this file (and to the ceiling), not a quiet new call in a component.
 */
export const ALLOWLIST: Record<string, number> = {};

/** Must equal the sum of ALLOWLIST. Lower it with every conversion; raising it is a visible, reviewed act. */
export const ALLOWLIST_CEILING = 0;

/** How many violations existed when the ratchet was introduced. Never changes: the ceiling may not exceed it. */
export const INITIAL_VIOLATIONS = 57;
