/**
 * msToWaitForSafeWindow (e2e/support/rate-limit-window.ts), the pure calculation behind the admin-lockout spec's boundary guard.
 *
 * `consume_anonymous_rate_limit` (migration 0117) counts in a WALL-CLOCK window: `window_start = to_timestamp(floor(epoch / window_seconds) * window_seconds)`. A spec
 * that must see eight wrong attempts and then a refused ninth inside ONE window fails whenever a boundary falls inside its sequence, a few percent of runs for a
 * 900 s window. The spec therefore asks this function how long to wait before it starts. The cases below pin the arithmetic against the SQL's own formula, and the two
 * numbers a careless version gets wrong: the window length (900 s for the admin login, not a round 1000) and "wait to just AFTER the boundary", not just up to it.
 */
import { describe, expect, it } from "vitest";
import { BOUNDARY_SLACK_MS, msToWaitForSafeWindow } from "../../e2e/support/rate-limit-window";

const WINDOW_S = 900;
const WINDOW_MS = WINDOW_S * 1000;
const MARGIN_MS = 40_000;
/** The SQL's window start, in ms, for a given instant. */
const sqlWindowStartMs = (nowMs: number) => Math.floor(nowMs / 1000 / WINDOW_S) * WINDOW_S * 1000;

describe("msToWaitForSafeWindow", () => {
  it("does not wait when at least the margin remains in the current window", () => {
    expect(msToWaitForSafeWindow(0, WINDOW_S, MARGIN_MS)).toBe(0); // the very start of a window
    expect(msToWaitForSafeWindow(10 * WINDOW_MS + 1, WINDOW_S, MARGIN_MS)).toBe(0); // 1 ms into one
    expect(msToWaitForSafeWindow(10 * WINDOW_MS + 450_000, WINDOW_S, MARGIN_MS)).toBe(0); // the middle
  });

  it("treats exactly the margin remaining as enough, and one millisecond less as not enough", () => {
    const boundary = 7 * WINDOW_MS;
    expect(msToWaitForSafeWindow(boundary - MARGIN_MS, WINDOW_S, MARGIN_MS)).toBe(0);
    expect(msToWaitForSafeWindow(boundary - MARGIN_MS + 1, WINDOW_S, MARGIN_MS)).toBe(MARGIN_MS - 1 + BOUNDARY_SLACK_MS);
  });

  it("waits to just AFTER the next boundary when less than the margin remains", () => {
    const boundary = 12 * WINDOW_MS;
    expect(msToWaitForSafeWindow(boundary - 5_000, WINDOW_S, MARGIN_MS)).toBe(5_000 + BOUNDARY_SLACK_MS);
    expect(msToWaitForSafeWindow(boundary - 1, WINDOW_S, MARGIN_MS)).toBe(1 + BOUNDARY_SLACK_MS);
    expect(BOUNDARY_SLACK_MS).toBeGreaterThan(0);
  });

  it("agrees with the SQL's window formula: after waiting, the whole margin fits in one window; with no wait, it already does", () => {
    for (let i = 0; i < 2000; i++) {
      const nowMs = 1_790_000_000_000 + Math.floor(Math.random() * 10 * WINDOW_MS) + Math.random();
      const wait = msToWaitForSafeWindow(nowMs, WINDOW_S, MARGIN_MS);
      const start = nowMs + wait;
      // The sequence [start, start + margin) must not cross a boundary (the SQL's window is the same at both ends).
      expect(sqlWindowStartMs(start), `now=${nowMs}`).toBe(sqlWindowStartMs(start + MARGIN_MS - 1));
      // And it never waits when it need not, nor longer than margin + slack.
      if (wait > 0) {
        expect(wait).toBeLessThanOrEqual(MARGIN_MS + BOUNDARY_SLACK_MS);
        expect(start - sqlWindowStartMs(start)).toBeCloseTo(BOUNDARY_SLACK_MS, 3); // just after the boundary
      }
    }
  });

  it("uses the window length it is given: 900 s and 1000 s disagree at 970 s into the epoch", () => {
    // 970 s: in a 900 s window that is 70 s in (830 s left, no wait); in a 1000 s window it is 970 s in (30 s left, less than the 40 s margin, so wait).
    expect(msToWaitForSafeWindow(970_000, 900, MARGIN_MS)).toBe(0);
    expect(msToWaitForSafeWindow(970_000, 1000, MARGIN_MS)).toBe(30_000 + BOUNDARY_SLACK_MS);
  });

  it("refuses inputs that cannot work rather than waiting forever or returning nonsense", () => {
    expect(() => msToWaitForSafeWindow(0, WINDOW_S, WINDOW_MS)).toThrow(RangeError); // a margin as long as the window can never fit
    expect(() => msToWaitForSafeWindow(0, WINDOW_S, WINDOW_MS + 1)).toThrow(RangeError);
    expect(() => msToWaitForSafeWindow(0, 0, 1000)).toThrow(RangeError);
    expect(() => msToWaitForSafeWindow(0, -900, 1000)).toThrow(RangeError);
    expect(() => msToWaitForSafeWindow(NaN, WINDOW_S, MARGIN_MS)).toThrow(RangeError);
    expect(() => msToWaitForSafeWindow(0, WINDOW_S, -1)).toThrow(RangeError);
  });
});
