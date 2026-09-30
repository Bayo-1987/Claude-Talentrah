/**
 * send-482 — the login limiter counts in FIXED windows, and a burst that straddles
 * a window boundary is counted in two. This file pins that, deterministically, with
 * no database.
 *
 * WHY IT EXISTS. tests/security/login-rate-limit.test.ts asserted "23 concurrent
 * calls -> exactly 20 allowed" and failed once in CI with `expected 23 to be 20`.
 * The limiter is not racy: `consume_anonymous_rate_limit` (0117) increments and
 * reads in one `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, so concurrent
 * callers each get a distinct count. The failed run had started at about
 * 11:44:59.95 and its burst ran across 11:45:00 — a boundary of the 15-minute
 * window. Split over two windows, each under 20, all 23 are allowed.
 *
 * THE CLOCK. The limiter takes its time from Postgres `now()`, so no clock can be
 * injected into the real function. tests/support/fake-anonymous-rate-limit.ts
 * re-implements 0117's documented behaviour with a clock the test owns; the REAL
 * `consumeLoginRateLimit` runs on top of it (only its database client is
 * replaced). That is what lets this file say "1 second before a boundary" and
 * mean it. The fake is only as right as its reading of 0117; the tests that hit
 * the real function (resend-rate-limit.test.ts, login-rate-limit.test.ts) are
 * what keep that honest.
 *
 * WHAT IS HERE.
 *   - a control: inside one window the fake admits exactly the limit;
 *   - THE DOCUMENTED BEHAVIOUR, NOT AN ENDORSEMENT: a straddling burst admits more
 *     than the limit, up to 2x — so "allows exactly N" assertions are only valid
 *     for a burst that stays in one window;
 *   - `inOneWindow` (tests/support/single-window.ts), the guard the database-backed
 *     test now uses: it retries a scenario that straddled a boundary.
 *
 * Nothing here changes the limiter. If login brute-force protection should not
 * admit 2x the limit across a boundary, that means a sliding window — a product
 * decision, not a test fix.
 *
 * No database, no network, no Supabase env.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createFakeAnonymousRateLimit,
  nextBoundaryMs,
  type FakeRateLimitClock,
} from "../support/fake-anonymous-rate-limit";
import { inOneWindow } from "../support/single-window";

const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => h.client }));

import { consumeLoginRateLimit, type LoginRateLimitOutcome } from "@/lib/security/login-rate-limit";

/** seekerLogin: 20 per 15 minutes (LOGIN_RATE_LIMITS). */
const LIMIT = 20;
const WINDOW_SECONDS = 15 * 60;
/** 11:45:00 UTC: a multiple of 900 s, i.e. a real window boundary. */
const BOUNDARY = Date.UTC(2026, 8, 30, 11, 45, 0);

let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter}.window-test`;

function burst(n: number, ip: string): Promise<LoginRateLimitOutcome[]> {
  return Promise.all(Array.from({ length: n }, () => consumeLoginRateLimit(ip, "seekerLogin")));
}
const allowedOf = (rs: LoginRateLimitOutcome[]) => rs.filter((r) => r.allowed).length;
const windowsOf = (rs: LoginRateLimitOutcome[]) => new Set(rs.map((r) => r.resetsAt));

describe("CONTROL: inside one window the fake admits exactly the limit", () => {
  it("23 calls, clock mid-window: 20 allowed, 3 denied, one window, ending at the next boundary", async () => {
    const clock: FakeRateLimitClock = { now: BOUNDARY + 5 * 60 * 1000 };
    h.client = createFakeAnonymousRateLimit(clock, 0);
    const results = await burst(23, freshIp());
    expect(allowedOf(results)).toBe(LIMIT);
    expect(results.length - allowedOf(results)).toBe(3);
    expect([...windowsOf(results)]).toEqual([new Date(nextBoundaryMs(clock.now, WINDOW_SECONDS)).toISOString()]);
  });

  it("the boundary instant itself belongs to the NEW window (floor(epoch / w) * w)", async () => {
    const clock: FakeRateLimitClock = { now: BOUNDARY };
    h.client = createFakeAnonymousRateLimit(clock, 0);
    const [r] = await burst(1, freshIp());
    expect(r!.resetsAt).toBe(new Date(BOUNDARY + WINDOW_SECONDS * 1000).toISOString());
  });
});

describe("DOCUMENTED BEHAVIOUR: a fixed window admits more than the limit across a boundary", () => {
  it("a 23-call burst that straddles a boundary is counted in TWO windows and all 23 are allowed", async () => {
    // The CI failure, reproduced: first call 1 s before the boundary, 100 ms per
    // call, so 10 calls land before it (t = -1000 ... -100) and 13 after (t = 0 ...).
    const clock: FakeRateLimitClock = { now: BOUNDARY - 1000 };
    h.client = createFakeAnonymousRateLimit(clock, 100);
    const results = await burst(23, freshIp());
    expect(windowsOf(results).size).toBe(2);
    expect(allowedOf(results), "an 'exactly 20 allowed' assertion would fail here").toBe(23);
  });

  it("up to 2x the limit can be admitted around one boundary: 20 just before + 20 just after = 40, the rest denied", async () => {
    const clock: FakeRateLimitClock = { now: BOUNDARY - 1 };
    h.client = createFakeAnonymousRateLimit(clock, 0);
    const ip = freshIp();

    const before = await burst(20, ip); // the old window's whole budget
    clock.now = BOUNDARY; //              the boundary passes
    const after = await burst(25, ip); //  a fresh budget

    expect(allowedOf(before)).toBe(20);
    expect(allowedOf(after)).toBe(20);
    expect(allowedOf(before) + allowedOf(after)).toBe(2 * LIMIT);
    expect(after.length - allowedOf(after)).toBe(5);
  });

  it("the sustained rate is unchanged: once the new window's budget is spent, further calls are denied", async () => {
    const clock: FakeRateLimitClock = { now: BOUNDARY };
    h.client = createFakeAnonymousRateLimit(clock, 0);
    const ip = freshIp();
    await burst(LIMIT, ip);
    clock.now = BOUNDARY + 60_000;
    const [later] = await burst(1, ip);
    expect(later!.allowed).toBe(false);
  });
});

describe("inOneWindow — the guard the database-backed test uses", () => {
  /** The original test's scenario: 23 calls on a fresh key, every outcome reported. */
  function seekerScenario(counter: { attempts: number }) {
    return async () => {
      counter.attempts += 1;
      const results = await burst(23, freshIp());
      return { results, outcomes: results };
    };
  }

  it("a scenario that straddles a boundary is run again and the assertion is made on the single-window run", async () => {
    const clock: FakeRateLimitClock = { now: BOUNDARY - 1000 };
    h.client = createFakeAnonymousRateLimit(clock, 100);
    const counter = { attempts: 0 };

    const { results } = await inOneWindow(seekerScenario(counter));

    expect(counter.attempts, "attempt 1 straddled the boundary, attempt 2 landed after it").toBe(2);
    expect(allowedOf(results)).toBe(LIMIT);
    expect(results.length - allowedOf(results)).toBe(3);
  });

  it("a scenario that is already in one window is not run twice", async () => {
    const clock: FakeRateLimitClock = { now: BOUNDARY + 5 * 60 * 1000 };
    h.client = createFakeAnonymousRateLimit(clock, 100);
    const counter = { attempts: 0 };

    const { results } = await inOneWindow(seekerScenario(counter));

    expect(counter.attempts).toBe(1);
    expect(allowedOf(results)).toBe(LIMIT);
  });

  it("gives up with a clear error if every attempt straddles, rather than asserting on a split run", async () => {
    let attempts = 0;
    const alwaysSplit = async () => {
      attempts += 1;
      return { outcomes: [{ resetsAt: "2026-09-30T11:45:00.000Z" }, { resetsAt: "2026-09-30T12:00:00.000Z" }] };
    };
    await expect(inOneWindow(alwaysSplit)).rejects.toThrow(/3 attempts in a row did not land in a single window/);
    expect(attempts).toBe(3);
  });

  it("does not accept a run whose counter call failed (null window) as 'one window'", async () => {
    await expect(
      inOneWindow(async () => ({ outcomes: [{ resetsAt: null }, { resetsAt: null }] }), 2),
    ).rejects.toThrow(/null window means the counter call itself failed/);
  });
});
