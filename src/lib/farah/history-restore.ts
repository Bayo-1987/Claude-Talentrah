/**
 * When Farah's thread comes back on its own (send-504, S7).
 *
 * The panel fetches the user's recent thread on load and HOLDS it behind "Continue where you left off with Farah?", so a stale fragment
 * of an old conversation never greets someone on an unrelated page. That is right for an old thread and wrong for the one you were in
 * a moment ago: the owner paid for two answers, reloaded, and they were gone behind that line.
 *
 * Owner's rule: if the LAST message is under 24 hours old, restore the thread automatically; an older one stays behind "Continue".
 * Nothing is deleted either way, and no retention period is promised (the history route already returns the last 20 messages with
 * no age cutoff).
 *
 * Pure so both sides of the line can be tested to the second. "Under 24 hours" is strict: exactly 24:00:00 stays behind Continue.
 * The newest timestamp wins (not the array's last element), so the answer does not depend on row order, and an unparseable
 * timestamp counts as old rather than as "now".
 */

export const AUTO_RESTORE_WINDOW_HOURS = 24;
const WINDOW_MS = AUTO_RESTORE_WINDOW_HOURS * 3_600_000;
/** A few minutes of server/browser clock skew is a live thread; a timestamp days ahead is bad data, not one. */
const MAX_CLOCK_SKEW_MS = 3_600_000;

export function shouldAutoRestoreHistory(messages: ReadonlyArray<{ created_at: string }>, now: Date): boolean {
  let newest = Number.NEGATIVE_INFINITY;
  for (const m of messages) {
    const t = Date.parse(m.created_at);
    if (!Number.isNaN(t) && t > newest) newest = t;
  }
  if (newest === Number.NEGATIVE_INFINITY) return false;
  const age = now.getTime() - newest;
  return age > -MAX_CLOCK_SKEW_MS && age < WINDOW_MS;
}
