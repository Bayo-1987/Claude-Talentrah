/**
 * Proves the counter's concurrency assertions can fail, with no database. The assertions in support/counter-assertions.ts run against an in-memory counter that adds atomically (they must pass) and one that reads, waits
 * and writes (they must fail). The database-backed run of the same assertions (tests/farah/llm-usage-counter.test.ts) has never been seen red locally; this is what stands in for that: the assertions do detect a lost update.
 * What this cannot show is that Postgres serialises the real INSERT ... ON CONFLICT: that is the database's documented behaviour, pinned in the migration by the single-statement shape test.
 */
import { describe, expect, it } from "vitest";
import { assertFirstCallerOnce, assertParallelAddsExact, type AddFn } from "./support/counter-assertions";

function atomicCounter(): AddFn {
  const totals = new Map<string, number>();
  return async (bucket, nano) => {
    const next = (totals.get(bucket) ?? 0) + nano; // one synchronous step: nothing can interleave
    totals.set(bucket, next);
    return next;
  };
}
/** A read-then-write counter: the shape of the bug the single statement avoids. */
function racyCounter(): AddFn {
  const totals = new Map<string, number>();
  return async (bucket, nano) => {
    const seen = totals.get(bucket) ?? 0;
    await new Promise((r) => setTimeout(r, 1)); // another caller reads the same value while this one waits
    totals.set(bucket, seen + nano);
    return seen + nano;
  };
}

describe("the assertions pass on an atomic counter", () => {
  it("parallel adds are exact, and exactly one caller sees the first count", async () => {
    await assertParallelAddsExact(atomicCounter(), "farah_chat");
    await assertFirstCallerOnce(atomicCounter(), "farah_chat_half_warned");
  });
});

describe("the assertions FAIL on a counter that reads, waits, then writes", () => {
  it("a lost update is detected in the parallel adds", async () => {
    await expect(assertParallelAddsExact(racyCounter(), "farah_chat")).rejects.toThrow();
  });
  it("a repeated first count is detected in the halfway marker", async () => {
    await expect(assertFirstCallerOnce(racyCounter(), "farah_chat_half_warned")).rejects.toThrow();
  });
});
