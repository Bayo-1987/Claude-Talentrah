/**
 * send-453 — regression coverage for migration 0188's test_user_pool
 * claim/release/reset cycle, which replaced tests/support/auth.ts's
 * create-then-delete-per-test with a reused pool (see that file's own
 * header on `createTestUser`/`deleteTestUsers` for the full reasoning:
 * 1,564 user_deleted + 559 user_signedup events in a single 24h window
 * against the shared dozaffzgqkbarxtlclsj, measured directly).
 *
 * The one thing a naive reuse could break, and the thing this file exists
 * to prove it does NOT: two different logical "test users" — whether two
 * tests in one run, or two concurrent local/agent sessions sharing this
 * same project — must never see or corrupt each other's data through a
 * shared pool row.
 *
 * ── WHY SOME TESTS "HOLD" THE REST OF THE POOL FIRST ────────────────────
 *
 * `claim_test_pool_user` intentionally has no way to ask for a SPECIFIC
 * row — it hands back whichever available row it finds, which is the
 * whole point (callers never know or care which physical row they get).
 *
 * ── WHY "HOLD EVERYTHING ELSE, THEN CLAIM ONCE" WAS WRONG ───────────────
 *
 * An earlier version of this file claimed every OTHER currently-available
 * row first (`holdRestOfPool`), so the target row was briefly the only
 * claimable one, then asserted the next claim equalled it. That is racy
 * against this repo's own real concurrency model, not a hypothetical:
 * vitest.config.ts's own comment documents 21 test files running in
 * parallel against this same shared `dozaffzgqkbarxtlclsj` pool, and any
 * of them can add a fresh overflow row (`add_test_pool_user`) or release
 * one of their own mid-enumeration. That is exactly what happened in CI —
 * `expect(claimedId).toBe(user.id)` failed once with a genuinely different
 * (also-legitimate) row, because something else freed up between
 * `holdRestOfPool` finishing and the real claim.
 *
 * `claimUntilTarget` fixes this by not caring how many other rows are
 * free: it drains claims one at a time (releasing every non-matching one
 * as it goes) until the SPECIFIC target row comes back, or the pool is
 * genuinely exhausted without ever producing it — which is the only
 * shape of failure that means something is actually wrong (the target
 * was stolen by a real concurrent claimant and never released, or isn't
 * in the pool at all). New rows appearing mid-drain no longer matter;
 * rows disappearing mid-drain (because a genuinely concurrent process
 * claims one first) is fine too — SKIP LOCKED just means that row is
 * unavailable this loop, exactly as it should be.
 */
import { describe, it, expect, afterAll } from "vitest";
import { admin, createTestUser, deleteTestUsers } from "./auth";
import { RUN_TAG } from "./list-users";

/**
 * Drains pool claims one at a time under `leaseId` until `targetUserId`
 * comes back, releasing every other row it passes through along the way.
 * Bounded at 50 attempts (comfortably above `POOL_MAX_SIZE` in auth.ts)
 * so a genuine bug — the target permanently gone — fails loudly instead
 * of hanging.
 */
async function claimUntilTarget(
  targetUserId: string,
  leaseId: string,
  prefix: string,
  makeEmail: (attempt: number) => string,
): Promise<{ drained: string[]; matchedEmail: string }> {
  const drained: string[] = [];
  for (let attempt = 0; attempt < 50; attempt++) {
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

async function releaseDrained(ids: string[], leaseId: string): Promise<void> {
  await Promise.all(
    ids.map((id) => admin.rpc("release_test_pool_user", { p_user_id: id, p_lease_id: leaseId })),
  );
}

describe("send-453: test_user_pool claim/release/reset", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    if (createdUserIds.length) {
      await deleteTestUsers(createdUserIds).catch(() => {});
    }
  });

  it("deleteTestUsers RELEASES a pooled user instead of deleting it", async () => {
    const user = await createTestUser("pool-release-check");
    createdUserIds.push(user.id);

    await deleteTestUsers([user.id]);

    const { data: authRow, error: authErr } = await admin.auth.admin.getUserById(user.id);
    expect(authErr).toBeNull();
    expect(authRow?.user?.id).toBe(user.id);

    const { data: poolRow } = await admin
      .from("test_user_pool")
      .select("leased_by")
      .eq("user_id", user.id)
      .maybeSingle();
    // NOT a strict "still unleased" check: this suite runs against the
    // real shared pool alongside every other concurrently-running vitest
    // worker, so the instant this release clears the lease, a genuinely
    // different, unrelated test file's own createTestUser call can
    // legitimately re-claim the same row — that is the pool working
    // exactly as intended under real concurrent load, not a bug. What
    // this test can actually prove is that RUN_TAG's OWN lease is gone;
    // it says nothing about whether some other run has since taken it.
    expect(poolRow?.leased_by).not.toBe(RUN_TAG);
  });

  it("a claim wipes a pooled user's owned data and profile fields back to defaults", async () => {
    // createTestUser already adds a genuinely new user to the pool leased
    // by THIS FILE'S OWN RUN_TAG (see auth.ts's claimFromPool overflow
    // path) — that's the real, current lease this test releases below.
    const user = await createTestUser("pool-reset-check");
    createdUserIds.push(user.id);

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
  });

  it("release_test_pool_user is a no-op against the WRONG lease id — it cannot steal someone else's claim", async () => {
    // Real lease already held is RUN_TAG (createTestUser's own claim), so
    // that's the "someone else's claim" this test tries — and must fail —
    // to release with an impostor lease id.
    const user = await createTestUser("pool-lease-guard-check");
    createdUserIds.push(user.id);

    const { error } = await admin.rpc("release_test_pool_user", {
      p_user_id: user.id,
      p_lease_id: "not-the-real-lease",
    });
    expect(error).toBeNull(); // a no-op, not a failure

    const { data: stillLeased } = await admin
      .from("test_user_pool")
      .select("leased_by")
      .eq("user_id", user.id)
      .single();
    expect(stillLeased?.leased_by).toBe(RUN_TAG);

    await admin.rpc("release_test_pool_user", { p_user_id: user.id, p_lease_id: RUN_TAG });
  });

  it("two concurrent claimants never receive the same pool row", async () => {
    const userA = await createTestUser("pool-concurrency-check-a");
    const userB = await createTestUser("pool-concurrency-check-b");
    createdUserIds.push(userA.id, userB.id);

    // Both already leased by this file's own RUN_TAG (createTestUser's own
    // claim) — free them under that real lease before the concurrent test.
    // (This test doesn't need holdRestOfPool: SKIP LOCKED guarantees no
    // duplicate claim regardless of how many OTHER rows are also free.)
    await admin.rpc("release_test_pool_user", { p_user_id: userA.id, p_lease_id: RUN_TAG });
    await admin.rpc("release_test_pool_user", { p_user_id: userB.id, p_lease_id: RUN_TAG });

    const [resultA, resultB] = await Promise.all([
      admin.rpc("claim_test_pool_user", {
        p_lease_id: "concurrent-claimant-1",
        p_prefix: "pool-concurrency-check",
        p_new_email: `pool-concurrency-1-${userA.id.slice(0, 6)}@talentrah.pool`,
        p_stale_after_seconds: 600,
      }),
      admin.rpc("claim_test_pool_user", {
        p_lease_id: "concurrent-claimant-2",
        p_prefix: "pool-concurrency-check",
        p_new_email: `pool-concurrency-2-${userB.id.slice(0, 6)}@talentrah.pool`,
        p_stale_after_seconds: 600,
      }),
    ]);

    expect(resultA.error).toBeNull();
    expect(resultB.error).toBeNull();
    expect(resultA.data).toBeTruthy();
    expect(resultB.data).toBeTruthy();
    // The core isolation guarantee: FOR UPDATE SKIP LOCKED means two
    // simultaneous claimants never walk away with the same row — this is
    // the exact failure mode a naive (non-atomic) reuse would reintroduce.
    expect(resultA.data).not.toBe(resultB.data);

    await admin.rpc("release_test_pool_user", { p_user_id: resultA.data!, p_lease_id: "concurrent-claimant-1" });
    await admin.rpc("release_test_pool_user", { p_user_id: resultB.data!, p_lease_id: "concurrent-claimant-2" });
  });

  it("an abandoned (stale) lease is reclaimable rather than stuck forever", async () => {
    const user = await createTestUser("pool-stale-check");
    createdUserIds.push(user.id);

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
    );
    await admin.rpc("release_test_pool_user", { p_user_id: user.id, p_lease_id: leaseId });
    await releaseDrained(drained, leaseId);
  });
});
