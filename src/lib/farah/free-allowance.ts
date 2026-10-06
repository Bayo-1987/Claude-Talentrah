/**
 * Farah chat's free-message allowance (0123): this many free messages per account in a ROLLING window of this many days, never a calendar month. Client-safe (no database, no server-only import), so the
 * gate, the billing facts and a panel can all read the same numbers.
 *
 * HOW A MESSAGE COMES BACK. A free message counts while it was logged at or after `freeWindowStart(now)` (now minus 30 days; exactly 30 days ago still counts). It returns 30 days after the moment it was
 * logged. A person is free again when fewer than 3 messages are inside the window, so the NEXT free message is the (n - 3 + 1)th oldest of the n inside it, plus 30 days: `nextFreeMessageAt`. The gate's own
 * count and this function use the same `freeWindowStart`, so they cannot disagree about the edge.
 */
export const FARAH_CHAT_FREE_ALLOWANCE = 3;
export const FARAH_CHAT_FREE_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

/** The earliest moment a free message still counts: `now` minus the window. A message logged at exactly this moment still counts (the gate's query is `created_at >= this`). */
export function freeWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - FARAH_CHAT_FREE_WINDOW_DAYS * DAY_MS);
}

/**
 * When the next free message comes back, from the times this person's free messages were logged. A free message is available again once FEWER than `FARAH_CHAT_FREE_ALLOWANCE` messages are inside the
 * window, so with `n` inside it the answer is the (n - ALLOWANCE + 1)th oldest of them (1-based, ascending), plus the window: the oldest when n is 3, the second oldest when n is 4. That is the oldest of the ALLOWANCE newest, so a caller needs to pass only those (it sorts for itself and ignores older rows). Fewer than ALLOWANCE
 * inside the window means a free message is already left, so there is nothing to wait for: `null`.
 *
 * n can exceed the allowance: the gate checks first and commits after the model call, so parallel requests can all pass the check (tests/farah/chat-gate-concurrent-commit.test.ts characterises this; it is
 * not fixed here). Taking the oldest in that case would name a moment when the count is still ALLOWANCE or more, and the person would be told a message is free when it is not.
 *
 * Counted exactly as the gate counts: a time is inside the window when it is `>= freeWindowStart(now)`, with NO upper bound (the gate's query has none, and the database's clock can run slightly ahead of
 * this server's, so a message logged "a moment from now" is still a message). Unreadable values are ignored. A message exactly 30 days old still counts, so the gate frees the slot one millisecond after
 * the returned instant. Pure: the caller passes the times (the gate reads them from credit_gate_events).
 */
export function nextFreeMessageAt(usedAt: ReadonlyArray<Date | string | number>, now: Date = new Date()): Date | null {
  const from = freeWindowStart(now).getTime();
  const inWindow: number[] = [];
  for (const raw of usedAt) {
    const t = raw instanceof Date ? raw.getTime() : new Date(raw as string | number).getTime();
    if (Number.isFinite(t) && t >= from) inWindow.push(t);
  }
  if (inWindow.length < FARAH_CHAT_FREE_ALLOWANCE) return null;
  inWindow.sort((a, b) => a - b);
  return new Date(inWindow[inWindow.length - FARAH_CHAT_FREE_ALLOWANCE] + FARAH_CHAT_FREE_WINDOW_DAYS * DAY_MS);
}
