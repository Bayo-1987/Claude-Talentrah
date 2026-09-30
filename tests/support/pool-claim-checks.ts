/**
 * The two checks in `test-user-pool.test.ts` that used to drain the shared pool looking for ONE specific row (#593).
 *
 * WHY THEY NO LONGER DRAIN. `claim_test_pool_user` returns the first claimable row its scan meets; the caller does not
 * control which. A drain that claims "everything until the target" has a moment when the target is the next row in
 * line, and one claim by any other lease in that gap takes it; the drain then throws. Another file's `createTestUser`
 * is a legitimate claimant, so that is not a bug the test can insist on.
 * Neither check needs that particular row, so neither asks for it:
 *   - the wipe check calls `reset_test_pool_user` on the row it owns (as test-user-pool-mentor-reset.test.ts does), and
 *     separately shows that a claim runs the reset on WHATEVER row it returns;
 *   - the stale-lease check reads the row's lease after its own claims, which changes whoever reclaimed it.
 *
 * `hooks.beforeClaim` exists for the interleaving scenarios in `test-user-pool.test.ts`: it runs before every claim a
 * check makes, which is where a second lease is made to take the only claimable row. `test-user-pool.test.ts` itself
 * passes none for the plain runs.
 */
import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "./auth";
import { RUN_TAG } from "./list-users";

export interface ClaimCheckHooks {
  /** Called before every claim a check makes; `target` is the row the check created. */
  beforeClaim?: (ctx: { attempt: number; target: string }) => Promise<void>;
}

async function claimOnce(leaseId: string, prefix: string, email: string) {
  const { data, error } = await admin.rpc("claim_test_pool_user", {
    p_lease_id: leaseId,
    p_prefix: prefix,
    p_new_email: email,
    p_stale_after_seconds: 600,
  });
  if (error) throw error;
  return data;
}

const releaseRow = (id: string, leaseId: string) =>
  admin.rpc("release_test_pool_user", { p_user_id: id, p_lease_id: leaseId });

/** A claim runs the reset, and the reset wipes a pooled user's owned data and profile fields back to defaults. */
export async function checkClaimResetsPooledUser(hooks?: ClaimCheckHooks): Promise<void> {
  const user = await createTestUser("pool-reset-check");
  const spares: string[] = [];
  try {
    const dirty = () =>
      admin.from("profiles").update({ first_name: "LEFTOVER-FROM-A-PREVIOUS-TEST", credits_balance: 999 }).eq("id", user.id);
    const profileOf = async (id: string) => {
      const { data } = await admin.from("profiles").select("first_name, credits_balance, email").eq("id", id).single();
      return data;
    };

    // 1. The reset, on the row this test owns — a mutated profile the way a previous test would leave it.
    const { error: dirtyErr } = await dirty();
    expect(dirtyErr).toBeNull();
    const resetEmail = `pool-reset-direct-${user.id.slice(0, 8)}@talentrah.pool`;
    const { error: resetErr } = await admin.rpc("reset_test_pool_user", { p_user_id: user.id, p_new_email: resetEmail });
    expect(resetErr).toBeNull();
    const afterReset = await profileOf(user.id);
    expect(afterReset?.first_name).toBeNull();
    expect(afterReset?.credits_balance).toBe(0);
    expect(afterReset?.email).toBe(resetEmail);

    // 2. A released user genuinely returns to the pool: this file's lease is gone. (Not "still unleased" — another
    //    file's createTestUser may already have claimed it, which is the pool working.)
    const { error: releaseErr } = await releaseRow(user.id, RUN_TAG);
    expect(releaseErr).toBeNull();
    const { data: row } = await admin.from("test_user_pool").select("leased_by").eq("user_id", user.id).maybeSingle();
    expect(row).not.toBeNull();
    expect(row?.leased_by).not.toBe(RUN_TAG);

    // 3. A claim runs the reset on whatever row it returns: the row comes back relabelled with the address passed to
    //    the claim, and wiped. If another lease takes the only claimable row first, the claim returns null — put a
    //    fresh claimable row in the pool and claim again.
    const leaseId = "claim-check";
    for (let attempt = 0; attempt < 5; attempt++) {
      await hooks?.beforeClaim?.({ attempt, target: user.id });
      const email = `pool-reset-check-claimed-${user.id.slice(0, 8)}-${attempt}-${randomUUID().slice(0, 6)}@talentrah.pool`;
      const claimed = await claimOnce(leaseId, "pool-reset-check", email);
      if (!claimed) {
        const spare = await createTestUser("pool-reset-spare");
        spares.push(spare.id);
        await releaseRow(spare.id, RUN_TAG);
        continue;
      }
      try {
        const profile = await profileOf(claimed);
        expect(profile?.first_name).toBeNull();
        expect(profile?.credits_balance).toBe(0);
        expect(profile?.email).toBe(email);
      } finally {
        await releaseRow(claimed, leaseId);
      }
      return;
    }
    throw new Error("checkClaimResetsPooledUser: five claims in a row found nothing claimable");
  } finally {
    await deleteTestUsers([user.id, ...spares]).catch(() => {});
  }
}

/** An abandoned (stale) lease is reclaimable rather than stuck forever. */
export async function checkStaleLeaseIsReclaimable(hooks?: ClaimCheckHooks): Promise<void> {
  const user = await createTestUser("pool-stale-check");
  const leaseId = "reclaimer";
  const held: string[] = [];
  try {
    // Already leased by this file's own RUN_TAG (createTestUser's claim).
    // Simulate "claimed a long time ago, process died before releasing" by
    // backdating that lease rather than waiting out the real window —
    // reclaim doesn't care WHO the stale lease belongs to, only how old
    // it is. A row that is neither unleased nor stale never matches
    // claim_test_pool_user's own WHERE clause, so the claims below only ever
    // touch rows that were already legitimately claimable — they can't
    // accidentally steal a different, genuinely active lease from a real
    // concurrent test.
    await admin
      .from("test_user_pool")
      .update({ leased_at: new Date(Date.now() - 3_600_000).toISOString() })
      .eq("user_id", user.id);

    // Claim until the pool has nothing claimable left or we see the target. The target is claimable now and, like any
    // claimable row, it can be taken by another file first — so a miss is not a failure; what must hold afterwards is
    // that the stale lease is no longer this file's.
    for (let attempt = 0; attempt < 50; attempt++) {
      await hooks?.beforeClaim?.({ attempt, target: user.id });
      const claimed = await claimOnce(leaseId, "pool-stale-check", `pool-stale-reclaimed-${user.id.slice(0, 6)}-${attempt}@talentrah.pool`);
      if (!claimed) break;
      held.push(claimed);
      if (claimed === user.id) break;
    }

    // The claiming transaction may still be committing when the loop ends (SKIP LOCKED skips a row another claim is
    // holding), so allow a moment for the row to show its new lease.
    let leasedBy: string | null | undefined = RUN_TAG;
    for (let i = 0; i < 20 && leasedBy === RUN_TAG; i++) {
      const { data } = await admin.from("test_user_pool").select("leased_by").eq("user_id", user.id).maybeSingle();
      leasedBy = data?.leased_by;
      if (leasedBy === RUN_TAG) await new Promise((r) => setTimeout(r, 100));
    }
    expect(leasedBy, "the stale lease was reclaimed by someone other than its backdated holder").not.toBe(RUN_TAG);
    if (held.includes(user.id)) expect(leasedBy).toBe(leaseId);
  } finally {
    await Promise.all(held.map((id) => releaseRow(id, leaseId)));
    await deleteTestUsers([user.id]).catch(() => {});
  }
}
