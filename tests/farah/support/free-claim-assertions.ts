/**
 * The concurrency assertions for the free-message claim, written against `claim(userId)` so the SAME assertions run against the real database (tests/farah/free-claim.test.ts, CI only) and against two
 * in-memory models (tests/farah/free-claim-race-detection.test.ts): one that decides atomically (they must pass) and one that reads, waits and writes (they must fail).
 */
import { expect } from "vitest";

export type ClaimResult = { ok: boolean; claimId: string | null; used: number };
export type ClaimFn = (userId: string) => Promise<ClaimResult>;

/** `n` concurrent claims for one account that has `alreadyUsed` of `allowance` used: exactly `allowance - alreadyUsed` succeed, the rest are refused, and no two share a claim id. */
export async function assertOnlyTheFreeSlotsAreGranted(claim: ClaimFn, userId: string, alreadyUsed: number, allowance = 3, n = 10): Promise<ClaimResult[]> {
  const results = await Promise.all(Array.from({ length: n }, () => claim(userId)));
  const won = results.filter((r) => r.ok);
  expect(won, "more claims succeeded than there were free slots").toHaveLength(allowance - alreadyUsed);
  expect(new Set(won.map((r) => r.claimId)).size, "two claims share an id").toBe(won.length);
  expect(results.filter((r) => !r.ok && r.claimId !== null), "a refused claim carries an id").toHaveLength(0);
  return results;
}
