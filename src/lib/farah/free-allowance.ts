/**
 * Farah chat's free-message allowance (0123): this many free messages per account in a ROLLING window of this many days, never a calendar month. Client-safe (no database, no server-only import), so the
 * gate, the billing facts and a panel can all read the same numbers.
 *
 * HOW A MESSAGE COMES BACK. A free message counts while it was logged at or after `freeWindowStart(now)` (now minus 30 days; exactly 30 days ago still counts). It returns exactly 30 days after the moment
 * it was logged, so the NEXT one to come back is the oldest message still inside the window, plus 30 days: `nextFreeMessageAt`. The gate's own count and this function use the same `freeWindowStart`,
 * so they cannot disagree about the edge.
 */
export const FARAH_CHAT_FREE_ALLOWANCE = 3;
export const FARAH_CHAT_FREE_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

/** The earliest moment a free message still counts: `now` minus the window. A message logged at exactly this moment still counts (the gate's query is `created_at >= this`). */
export function freeWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - FARAH_CHAT_FREE_WINDOW_DAYS * DAY_MS);
}

/**
 * When the next free message comes back, from the times this person's free messages were logged: the oldest one still inside the window, plus the window. `null` when none is inside the window (nothing
 * is coming back). Times outside the window, in the future, or unreadable are ignored. Pure: the caller passes the times (the gate reads them from credit_gate_events).
 */
export function nextFreeMessageAt(usedAt: ReadonlyArray<Date | string | number>, now: Date = new Date()): Date | null {
  const from = freeWindowStart(now).getTime();
  let oldest: number | null = null;
  for (const raw of usedAt) {
    const t = raw instanceof Date ? raw.getTime() : new Date(raw as string | number).getTime();
    if (!Number.isFinite(t) || t < from || t > now.getTime()) continue;
    if (oldest === null || t < oldest) oldest = t;
  }
  return oldest === null ? null : new Date(oldest + FARAH_CHAT_FREE_WINDOW_DAYS * DAY_MS);
}
