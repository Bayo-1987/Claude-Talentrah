/**
 * send-140 — the referral leaderboard's own pure period logic. No database:
 * everything here is arithmetic on a `Date`, so the month-rollover behaviour
 * is testable directly, matching this repo's own convention of pulling
 * decision logic out of the query layer (getJobShareVisibility, digest's
 * selectDigestJobs).
 *
 * ── WHY A GRACE WINDOW AT ALL ──────────────────────────────────────────────
 *
 * The ranking window is the current calendar month — reset every rollover.
 * Without a grace period, someone who checked the board on the 30th at #2
 * and checks again on the 1st sees themselves gone, with no explanation: the
 * board did not remember them, it just started counting a new month. A few
 * days of "last month's final standings, read-only" closes that gap without
 * ever mixing two months' counts into one ranking.
 */
export const LEADERBOARD_GRACE_DAYS = 3;

export interface Period {
  /** Inclusive. */
  start: string;
  /** Exclusive. */
  end: string;
}

/**
 * The calendar month containing `now`, or an earlier one if `monthsAgo > 0`
 * — in UTC, so this does not depend on the server process's local timezone.
 */
export function monthRange(now: Date, monthsAgo = 0): Period {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * True for the first `LEADERBOARD_GRACE_DAYS` days of the month — the window
 * where last month's final standings are still worth showing alongside the
 * (freshly reset) current month.
 */
export function isWithinRolloverGrace(now: Date): boolean {
  return now.getUTCDate() <= LEADERBOARD_GRACE_DAYS;
}
