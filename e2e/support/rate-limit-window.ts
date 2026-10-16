/**
 * How long a spec must wait before it starts a sequence that has to stay inside ONE rate-limit window.
 *
 * `consume_anonymous_rate_limit` (supabase/migrations/0117_anonymous_rate_limits.sql) counts in a wall-clock window:
 * `window_start = to_timestamp(floor(epoch / window_seconds) * window_seconds)`. Every request in the same window adds to one counter; the first request after a
 * boundary starts a new counter at 1. A spec that makes eight wrong attempts and expects the ninth to be refused (admin login: 8 per 900 s, src/lib/security/login-rate-limit.ts)
 * therefore fails whenever a boundary falls inside its sequence: the ninth lands in a fresh window and is allowed. A sliding window would remove the cliff in the product;
 * that is a separate decision with a migration. Until then the spec asks this function whether there is room.
 *
 * Pure, so the arithmetic can be pinned by a unit test (tests/support/rate-limit-window.test.ts) without a clock or a database.
 */

/** How far past the boundary to start, so a clock a hair behind the database's still lands inside the NEW window. */
export const BOUNDARY_SLACK_MS = 1000;

/**
 * Milliseconds to wait before starting a sequence that needs `marginMs` of an uninterrupted window.
 * 0 when at least `marginMs` remains in the window that `nowMs` (epoch milliseconds) is in; otherwise the time to just after the next boundary
 * (the remainder of this window plus BOUNDARY_SLACK_MS), which is never more than `marginMs + BOUNDARY_SLACK_MS`.
 * Throws a RangeError for a margin that cannot fit in the window (it would wait forever) and for non-finite or non-positive inputs.
 */
export function msToWaitForSafeWindow(nowMs: number, windowSeconds: number, marginMs: number): number {
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new RangeError(`msToWaitForSafeWindow: nowMs must be a finite epoch time, got ${nowMs}`);
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) throw new RangeError(`msToWaitForSafeWindow: windowSeconds must be positive, got ${windowSeconds}`);
  if (!Number.isFinite(marginMs) || marginMs < 0) throw new RangeError(`msToWaitForSafeWindow: marginMs must be zero or more, got ${marginMs}`);
  const windowMs = windowSeconds * 1000;
  if (marginMs >= windowMs) throw new RangeError(`msToWaitForSafeWindow: a ${marginMs} ms margin cannot fit in a ${windowMs} ms window`);

  const remainingMs = windowMs - (nowMs % windowMs);
  return remainingMs >= marginMs ? 0 : remainingMs + BOUNDARY_SLACK_MS;
}
