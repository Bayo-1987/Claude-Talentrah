/**
 * The two checks in `test-user-pool.test.ts` that used to drain the shared pool looking for ONE specific row,
 * pulled out so `test-user-pool-interleavings.test.ts` can drive them through a deterministic interleaving (#593).
 *
 * `hooks.beforeClaim` exists for that interleaving test only. `test-user-pool.test.ts` passes none.
 */
import { expect } from "vitest";
import { admin, createTestUser, deleteTestUsers } from "./auth";
import { RUN_TAG } from "./list-users";

export interface ClaimCheckHooks {
  /** Called before every claim `claimUntilTarget` makes. */
  beforeClaim?: (ctx: { attempt: number; target: string }) => Promise<void>;
}

/**
 * Drains pool claims one at a time under `leaseId` until `targetUserId`
 * comes back, releasing every other row it passes through along the way.
 * Bounded at 50 attempts (comfortably above `POOL_MAX_SIZE` in auth.ts)
 * so a genuine bug — the target permanently gone — fails loudly instead
 * of hanging.
 */
export async function claimUntilTarget(
  targetUserId: string,
  leaseId: string,
  prefix: string,
  makeEmail: (attempt: number) => string,
  hooks?: ClaimCheckHooks,
): Promise<{ drained: string[]; matchedEmail: string }> {
  const drained: string[] = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    await hooks?.beforeClaim?.({ attempt, target: targetUserId });
    const email = makeEmail(attempt);
    const { data, error } = await admin.rpc("claim_test_pool_user", {
      p_lease_id: leaseId,
      p_prefix: prefix,
      p_new_email: email,
      p_stale_after_seconds: 600,
    });
    if (error) {
      await releaseDrained(drained, leaseId);
      throw error;
    }
    if (!data) {
      await releaseDrained(drained, leaseId);
      throw new Error(
        `claimUntilTarget: drained the entire pool (${attempt} row${attempt === 1 ? "" : "s"}) under ` +
          `lease "${leaseId}" without ever seeing ${targetUserId} — either it was claimed by a genuinely ` +
          `different process and never released, or it isn't in the pool.`,
      );
    }
    if (data === targetUserId) return { drained, matchedEmail: email };
    drained.push(data);
  }
  await releaseDrained(drained, leaseId);
  throw new Error(`claimUntilTarget: exceeded 50 attempts without finding ${targetUserId}`);
}

export async function releaseDrained(ids: string[], leaseId: string): Promise<void> {
  await Promise.all(
    ids.map((id) => admin.rpc("release_test_pool_user", { p_user_id: id, p_lease_id: leaseId })),
  );
}

/** A claim wipes a pooled user's owned data and profile fields back to defaults. */
export async function checkClaimResetsPooledUser(hooks?: ClaimCheckHooks): Promise<void> {
  const user = await createTestUser("pool-reset-check");
  try {
    // Dirty it exactly the way a previous test's leftover state would —
    // a mutated profile field the reset must clear.
    const { error: dirtyErr } = await admin
      .from("profiles")
      .update({ first_name: "LEFTOVER-FROM-A-PREVIOUS-TEST", credits_balance: 999 })
      .eq("id", user.id);
    expect(dirtyErr).toBeNull();

    const { error: releaseErr } = await admin.rpc("release_test_pool_user", {
      p_user_id: user.id,
      p_lease_id: RUN_TAG,
    });
    expect(releaseErr).toBeNull();

    const leaseId = "claim-check";
    const { drained, matchedEmail } = await claimUntilTarget(
      user.id,
      leaseId,
      "pool-reset-check",
      (attempt) => `pool-reset-check-claimed-${user.id.slice(0, 8)}-${attempt}@talentrah.pool`,
      hooks,
    );
    try {
      const { data: profile } = await admin
        .from("profiles")
        .select("first_name, credits_balance, email")
        .eq("id", user.id)
        .single();
      expect(profile?.first_name).toBeNull();
      expect(profile?.credits_balance).toBe(0);
      expect(profile?.email).toBe(matchedEmail);
    } finally {
      await admin.rpc("release_test_pool_user", { p_user_id: user.id, p_lease_id: leaseId });
      await releaseDrained(drained, leaseId);
    }
  } finally {
    await deleteTestUsers([user.id]).catch(() => {});
  }
}

/** An abandoned (stale) lease is reclaimable rather than stuck forever. */
export async function checkStaleLeaseIsReclaimable(hooks?: ClaimCheckHooks): Promise<void> {
  const user = await createTestUser("pool-stale-check");
  try {
    // Already leased by this file's own RUN_TAG (createTestUser's claim).
    // Simulate "claimed a long time ago, process died before releasing" by
    // backdating that lease rather than waiting out the real window —
    // reclaim doesn't care WHO the stale lease belongs to, only how old
    // it is. A row that is neither unleased nor stale never matches
    // claim_test_pool_user's own WHERE clause, so claimUntilTarget's drain
    // below only ever touches rows that were already legitimately
    // claimable — it can't accidentally steal a different, genuinely
    // active lease from a real concurrent test.
    await admin
      .from("test_user_pool")
      .update({ leased_at: new Date(Date.now() - 3_600_000).toISOString() })
      .eq("user_id", user.id);

    const leaseId = "reclaimer";
    const { drained } = await claimUntilTarget(
      user.id,
      leaseId,
      "pool-stale-check",
      (attempt) => `pool-stale-reclaimed-${user.id.slice(0, 6)}-${attempt}@talentrah.pool`,
      hooks,
    );
    await admin.rpc("release_test_pool_user", { p_user_id: user.id, p_lease_id: leaseId });
    await releaseDrained(drained, leaseId);
  } finally {
    await deleteTestUsers([user.id]).catch(() => {});
  }
}
