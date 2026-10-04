/**
 * The concurrency assertions for the usage counter, written against an `add(bucket, nano)` function so the SAME assertions run against the real database (tests/farah/llm-usage-counter.test.ts, CI only) and
 * against two in-memory counters (tests/farah/counter-race-detection.test.ts): one that adds atomically and one that reads, waits and writes. That second run is the proof that these assertions can fail,
 * which the database run cannot give locally.
 *
 * They read the counter as DELTAS (read, add, compare), never as absolute totals, so a row that earlier tests or earlier runs on the same database already wrote to does not matter. They are exact
 * only because nothing else writes to the counter while they run, which tests/farah/tally-isolation.test.ts enforces.
 */
import { expect } from "vitest";

export type AddFn = (bucket: string, nano: number) => Promise<number>;

/** `n` concurrent adds of `each`: no lost update (final minus base is exactly n x each) and every call saw a different running total. */
export async function assertParallelAddsExact(add: AddFn, bucket: string, n = 50, each = 1000): Promise<void> {
  const base = await add(bucket, 0);
  const results = await Promise.all(Array.from({ length: n }, () => add(bucket, each)));
  const final = await add(bucket, 0);
  expect(final - base, "a concurrent add was lost").toBe(n * each);
  expect(new Set(results).size, "two adds saw the same running total").toBe(n);
  expect(Math.min(...results)).toBeGreaterThan(base);
  expect(Math.max(...results)).toBe(final);
}

/** `n` concurrent adds of 1 to the call-count bucket: the results are exactly base+1 .. base+n, and from a fresh day exactly one caller sees 1. */
export async function assertFirstCallerOnce(add: AddFn, bucket: string, n = 50): Promise<void> {
  const base = await add(bucket, 0);
  const results = (await Promise.all(Array.from({ length: n }, () => add(bucket, 1)))).sort((a, b) => a - b);
  expect(results, "a count was lost or repeated").toEqual(Array.from({ length: n }, (_, i) => base + i + 1));
  if (base === 0) expect(results.filter((r) => r === 1), "more than one caller saw the first count").toHaveLength(1);
}
