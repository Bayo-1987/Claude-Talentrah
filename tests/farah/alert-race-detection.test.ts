/**
 * Proves the alert-attempt concurrency assertions can fail, with no database. They run against an in-memory model that decides atomically (they must pass) and one that reads the state, waits,
 * and then writes (they must fail). The database-backed run of the same assertions (tests/farah/llm-alert-attempts.test.ts) is CI's first run; this is what stands in for it here.
 * What this cannot show is that Postgres serialises the real INSERT ... ON CONFLICT DO UPDATE ... WHERE: that is documented database behaviour, and the shape test pins the one-statement form.
 */
import { describe, expect, it } from "vitest";
import { assertAttemptsBounded, assertOneAttemptInFlight, type ClaimFn } from "./support/alert-assertions";

interface State {
  attempts: number;
  lastAttemptAt: number | null;
  sent: boolean;
}
const now = () => Date.now();
const mayTry = (s: State, max: number, lease: number) => !s.sent && s.attempts < max && (s.lastAttemptAt === null || s.lastAttemptAt <= now() - lease * 1000);

function atomicModel(): ClaimFn {
  const state = new Map<string, State>();
  return async (alert, max, lease) => {
    const s = state.get(alert) ?? { attempts: 0, lastAttemptAt: null, sent: false };
    state.set(alert, s);
    if (!mayTry(s, max, lease)) return false; // check and increment in one synchronous step: nothing can interleave
    s.attempts += 1;
    s.lastAttemptAt = now();
    return true;
  };
}
/** The shape of the bug the single statement avoids: read, wait (another caller reads the same state), then write. */
function racyModel(): ClaimFn {
  const state = new Map<string, State>();
  return async (alert, max, lease) => {
    const s = state.get(alert) ?? { attempts: 0, lastAttemptAt: null, sent: false };
    state.set(alert, s);
    const allowed = mayTry(s, max, lease);
    await new Promise((r) => setTimeout(r, 1));
    if (!allowed) return false;
    s.attempts += 1;
    s.lastAttemptAt = now();
    return true;
  };
}

describe("the assertions pass on a model that decides atomically", () => {
  it("one attempt in flight under a lease, and attempts bounded without one", async () => {
    await assertOneAttemptInFlight(atomicModel());
    await assertAttemptsBounded(atomicModel());
  });
});

describe("the assertions FAIL on a model that reads, waits, then writes", () => {
  it("two callers getting the attempt at once is detected", async () => {
    await expect(assertOneAttemptInFlight(racyModel())).rejects.toThrow();
  });
  it("going past the maximum number of attempts is detected", async () => {
    await expect(assertAttemptsBounded(racyModel())).rejects.toThrow();
  });
});
