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
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "./auth";
import { insertPoolFixtureRow } from "./pool-fixtures";
import { checkClaimResetsPooledUser, checkStaleLeaseIsReclaimable, type ClaimCheckHooks } from "./pool-claim-checks";
import { RUN_TAG } from "./list-users";

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
    await checkClaimResetsPooledUser();
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
    await checkStaleLeaseIsReclaimable();
  });
});

/**
 * #593 — the two test-pool races, written as deterministic interleavings instead of waited-for luck.
 *
 * Both failures are a second claimant getting in at one specific point. This file puts it there, on purpose, using the
 * real `claim_test_pool_user` / `release_test_pool_user` on whatever database the suite runs against. Each scenario
 * runs ITERATIONS times in one go, so a single run reports n/n rather than "it passed once".
 *
 * B — the drain. `claim_test_pool_user` takes the OLDEST claimable row first, so a just-released (or just-backdated)
 *     target is the NEWEST and comes last. A drain that claims "everything until the target" leaves the target as the
 *     only claimable row until its final claim. One claim by any other lease in that gap takes it; the drain's next
 *     claim returns null and it throws "drained the entire pool (N rows) … without ever seeing <id>". The other lease
 *     is a legitimate claimant (another file's `createTestUser`), so the drain cannot treat that as a bug.
 *     The interposing lease is fired from `hooks.beforeClaim` the moment the target is the only claimable row.
 *
 * A — a leaseless fixture row. A row a test inserts without `leased_by` is claimable. Here a second lease claims it
 *     while it is the only claimable row, the file that made it deletes the auth user as
 *     `tests/rls/test-user-pool-privileges.test.ts` does, and the claimant's `updateUserById` (what `claimFromPool`
 *     does next, tests/support/auth.ts) fails.
 *
 * Other files share the pool while this runs. Before acting, each scenario checks through a direct SELECT that the row it
 * cares about is the ONLY claimable one, and claims any other claimable row under its own lease first (releasing them
 * afterwards). The interposing claim is fired only when that check holds. A scenario that never reaches the check does
 * not fail here: on code that still has the race, the failure text below is what shows it was reached.
 */
/*
 * WHY THE INTERLEAVINGS LIVE IN THIS FILE. They hold every claimable pool row under their own leases for a moment, and
 * a few tests here call `claim_test_pool_user` directly and expect a row back. Run from another file they would starve
 * those tests (measured: two of this file's own tests failed when the two files ran in parallel). Vitest runs one
 * file's tests in sequence, so keeping them together means the only direct claimants they can collide with are
 * each other's. Other files claim through `createTestUser`, which overflows to a fresh user when the pool is empty.
 */
const ITERATIONS = 20;
const STALE_AFTER_SECONDS = 600;

/** Ids `claim_test_pool_user(…, 600)` could hand out right now. */
async function claimableIds(): Promise<string[]> {
  const cutoff = new Date(Date.now() - STALE_AFTER_SECONDS * 1000).toISOString();
  const { data, error } = await admin.from("test_user_pool").select("user_id").or(`leased_by.is.null,leased_at.lt.${cutoff}`);
  if (error) throw error;
  return (data ?? []).map((r) => r.user_id);
}

async function claimAs(lease: string): Promise<string | null> {
  const { data, error } = await admin.rpc("claim_test_pool_user", {
    p_lease_id: lease,
    p_prefix: "pool-interleave",
    p_new_email: `pool-interleave-${randomUUID()}@talentrah.pool`,
    p_stale_after_seconds: STALE_AFTER_SECONDS,
  });
  if (error) throw error;
  return data;
}

const release = (id: string, lease: string) => admin.rpc("release_test_pool_user", { p_user_id: id, p_lease_id: lease });

describe("B: a second lease claims the drain's target in the final-row gap", () => {
  async function interleaved(check: (hooks: ClaimCheckHooks) => Promise<void>) {
    const failures: string[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const lease = `interposer-${randomUUID().slice(0, 8)}`;
      let interposed: string | null = null;
      const hooks: ClaimCheckHooks = {
        async beforeClaim({ target }) {
          if (interposed) return;
          const ids = await claimableIds();
          if (ids.length !== 1 || ids[0] !== target) return;
          const got = await claimAs(lease); // another file's createTestUser: one claim, at the worst moment
          if (got === target) interposed = got;
          else if (got) await release(got, lease);
        },
      };
      try {
        await check(hooks);
      } catch (e) {
        failures.push(`#${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (interposed) await release(interposed, lease);
      }
    }
    return { failures };
  }

  it("the wipe check still passes when the target is taken by another lease", async () => {
    const { failures } = await interleaved(checkClaimResetsPooledUser);
    expect(failures.length, `${failures.length}/${ITERATIONS} interleavings failed the wipe check; first: ${failures[0]}`).toBe(0);
  }, 180_000);

  it("the stale-lease check still passes when the target is taken by another lease", async () => {
    const { failures } = await interleaved(checkStaleLeaseIsReclaimable);
    expect(failures.length, `${failures.length}/${ITERATIONS} interleavings failed the stale-lease check; first: ${failures[0]}`).toBe(0);
  }, 180_000);
});

describe("A: a leaseless fixture row is claimed while it is the only claimable row", () => {
  it("a fixture row inserted by insertPoolFixtureRow is never handed to another lease", async () => {
    const claimedLeaseless: string[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `pool-fixture-raw-${randomUUID()}@talentrah.test`,
        email_confirm: true,
      });
      if (error) throw error;
      const rawId = data.user!.id;
      const holdLease = `hold-${randomUUID().slice(0, 8)}`;
      const claimantLease = `claimant-${randomUUID().slice(0, 8)}`;
      const held: string[] = [];
      try {
        const { error: insertErr } = await insertPoolFixtureRow(rawId, "pool-fixture-check");
        expect(insertErr, "the service role must be able to insert the fixture row").toBeNull();

        for (let attempt = 0; attempt < 50; attempt++) {
          const ids = await claimableIds();
          if (!ids.includes(rawId)) break; // a leased row is skipped: nothing to interleave
          if (ids.length === 1) {
            // the raw row is the only claimable row: a second lease claims it
            const got = await claimAs(claimantLease);
            if (got === rawId) {
              // …and the file that made it cleans up, as test-user-pool-privileges.test.ts's afterAll does
              await admin.auth.admin.deleteUser(rawId);
              const { error: updErr } = await admin.auth.admin.updateUserById(rawId, {
                email: `pool-fixture-relabel-${randomUUID()}@talentrah.pool`,
                email_confirm: true,
              });
              claimedLeaseless.push(
                `claimed, then its auth user was deleted; the claimant's updateUserById failed with ${updErr?.status} ${updErr?.code ?? updErr?.name}: ${updErr?.message}`,
              );
            } else if (got) {
              held.push(got); // someone else's row got in first; keep it out of the way and look again
            }
            break;
          }
          const other = await claimAs(holdLease); // drain the older claimable rows so the raw row is the only one left
          if (other === rawId) {
            claimedLeaseless.push("claimed while it was still the oldest claimable row");
            break;
          }
          if (other) held.push(other);
        }
      } finally {
        await Promise.all(held.map((id) => release(id, holdLease)));
        await release(rawId, claimantLease);
        await admin.auth.admin.deleteUser(rawId).catch(() => {});
      }
    }
    expect(
      claimedLeaseless.length,
      `${claimedLeaseless.length}/${ITERATIONS} fixture rows were claimed by a second lease while they were the only claimable row; e.g. ${claimedLeaseless[0]}`,
    ).toBe(0);
  }, 180_000);
});
