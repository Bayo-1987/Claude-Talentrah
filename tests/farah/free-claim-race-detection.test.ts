/**
 * Proves the free-claim concurrency assertion can fail, with no database. It runs against an in-memory model that decides in one step (it must pass) and one that reads the count, waits, and then
 * writes (it must fail: that is the shape of today's check-then-commit). The database-backed run of the same assertion (tests/farah/free-claim.test.ts) is CI's first run; this is what stands in for it
 * here. What this cannot show is that Postgres serialises the real claim: that is the per-user advisory lock the migration takes, pinned by the shape test.
 */
import { describe, expect, it } from "vitest";
import { assertOnlyTheFreeSlotsAreGranted, type ClaimFn } from "./support/free-claim-assertions";
import { freeClaimRpc, type ClaimStore } from "./support/free-claim-model";

const args = (user: string) => ({ p_user_id: user, p_allowance: 3, p_window_days: 30, p_hold_seconds: 120 });
const fromRow = (data: unknown) => {
  const r = (data as Array<{ ok: boolean; claim_id: string | null; used: number }>)[0];
  return { ok: r.ok, claimId: r.claim_id, used: r.used };
};
function seeded(user: string, used: number): ClaimStore {
  return { credit_gate_events: Array.from({ length: used }, () => ({ user_id: user, reason: "farah_chat_message", outcome: "covered_by_free_allowance", created_at: new Date().toISOString() })) };
}

function atomicModel(store: ClaimStore): ClaimFn {
  return async (user) => fromRow(freeClaimRpc(store, "claim_farah_free_message", args(user)).data);
}
/** Reads the count, lets other callers read the same count, then records: the bug the single locked statement avoids. */
function racyModel(store: ClaimStore): ClaimFn {
  let seq = 0;
  return async (user) => {
    const used = (store.credit_gate_events ?? []).length + (store.farah_free_claims ?? []).length;
    await new Promise((r) => setTimeout(r, 1));
    if (used >= 3) return { ok: false, claimId: null, used };
    const id = `racy-${(seq += 1)}-${Math.random()}`;
    (store.farah_free_claims ??= []).push({ id, user_id: user, expires_at: Date.now() + 120_000 });
    return { ok: true, claimId: id, used: used + 1 };
  };
}

describe("the assertion passes on a model that decides in one step", () => {
  it("10 concurrent claims with 2 of 3 used: exactly 1 succeeds; with 0 used: exactly 3", async () => {
    await assertOnlyTheFreeSlotsAreGranted(atomicModel(seeded("u1", 2)), "u1", 2);
    await assertOnlyTheFreeSlotsAreGranted(atomicModel(seeded("u2", 0)), "u2", 0);
  });
});

describe("the assertion FAILS on a model that reads, waits, then writes", () => {
  it("more claims than free slots is detected", async () => {
    await expect(assertOnlyTheFreeSlotsAreGranted(racyModel(seeded("u3", 2)), "u3", 2)).rejects.toThrow();
  });
});
