/**
 * The concurrency assertions for the operator-alert attempts, written against a `claim(alert, maxAttempts, leaseSeconds)` function so the SAME assertions run against the real database
 * (tests/farah/llm-alert-attempts.test.ts, CI only) and against two in-memory models (tests/farah/alert-race-detection.test.ts): one that decides atomically (they must pass) and one that
 * reads, waits and writes (they must fail). The caller starts each from a clean state for the alert.
 */
import { expect } from "vitest";

export type AlertName = "eighty" | "reached";
export type ClaimFn = (alert: AlertName, maxAttempts: number, leaseSeconds: number) => Promise<boolean>;

/** `n` concurrent callers, a lease of 10 seconds: exactly ONE gets the attempt (only one send in flight at a time). */
export async function assertOneAttemptInFlight(claim: ClaimFn, alert: AlertName = "eighty", n = 50): Promise<void> {
  const results = await Promise.all(Array.from({ length: n }, () => claim(alert, 3, 10)));
  expect(results.filter(Boolean), "more than one caller got the attempt at the same time").toHaveLength(1);
}

/** `n` concurrent callers with no lease and a maximum of `max`: exactly `max` get an attempt, however many ask. */
export async function assertAttemptsBounded(claim: ClaimFn, alert: AlertName = "eighty", n = 50, max = 3): Promise<void> {
  const results = await Promise.all(Array.from({ length: n }, () => claim(alert, max, 0)));
  expect(results.filter(Boolean), "the number of attempts went past the maximum").toHaveLength(max);
}
