import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/types";

/**
 * A mutex for the suites that assert on a GLOBAL invariant.
 *
 * See supabase/migrations/0082_ci_test_locks.sql for the full reasoning. The
 * short version: `admin_operators_covered()` asks "does ANY active admin hold
 * `operators`", so a test asserting "this is the last holder, refuse to
 * disable it" is only correct while no other holder exists anywhere. vitest
 * runs files in parallel, and every open PR's CI shares one Supabase project,
 * so "anywhere" includes another file and another pull request.
 *
 * Anything that creates an admin holding `operators` takes this lease first.
 * Not everything that creates an admin — only the ones that move that global
 * number, because a mutex that covers more than the invariant it protects is
 * just a slower test suite.
 *
 * ── Using it ──────────────────────────────────────────────────────────────
 *
 *   let release: (() => Promise<void>) | undefined;
 *   beforeAll(async () => {
 *     release = await acquireOperatorsLock(admin, "admin-permissions");
 *     …create fixtures…
 *   });
 *   afterAll(async () => {
 *     …delete fixtures…
 *     await release?.();          // AFTER the fixtures are gone, not before
 *   });
 *
 * Releasing before teardown would hand the lock to a waiter while this suite's
 * operators-holding admins are still in the table, which is precisely the
 * situation the lock exists to prevent.
 */

/** One lease name for one invariant. A second invariant gets a second name. */
export const OPERATORS_COVERAGE_LOCK = "admin_operators_coverage";

export interface OperatorsLockOptions {
  /**
   * How long a single lease is good for before it can be stolen as stale.
   *
   * Kept SHORT deliberately. This was 300s and a suite whose afterAll threw
   * before reaching its release left the lease standing for the full five
   * minutes — every run in that window failed its beforeAll and reported
   * "skipped", which reads like nothing ran rather than like a lock problem.
   * The release is now in a finally, and this is the backstop for the case
   * where the process dies outright and no finally runs at all.
   */
  ttlSeconds?: number;
  /** Give up waiting after this long. */
  waitTimeoutMs?: number;
}

/**
 * Block until this process holds the lease, then keep it renewed.
 *
 * Returns the release function. Renewal matters: a suite slower than one TTL
 * would otherwise lose the lock mid-run to a waiter and fail in the confusing
 * way that started all this, rather than failing as a timeout.
 */
/*
 * Typed locally rather than from the generated Database type.
 * src/lib/supabase/types.ts is generated from a live project, so regenerating
 * it to pick up 0082 would also pick up every other migration applied to that
 * project but not yet merged. The RPC contract is small and stated here.
 */
type LockRpc = {
  rpc(
    fn: "ci_test_lock_acquire",
    args: { p_name: string; p_holder: string; p_ttl_seconds: number },
  ): Promise<{ data: boolean | null; error: { message: string } | null }>;
  rpc(
    fn: "ci_test_lock_release",
    args: { p_name: string; p_holder: string },
  ): Promise<{ data: boolean | null; error: { message: string } | null }>;
};

export async function acquireOperatorsLock(
  admin: SupabaseClient<Database>,
  label: string,
  opts: OperatorsLockOptions = {},
): Promise<() => Promise<void>> {
  const rpc = admin as unknown as LockRpc;
  const ttlSeconds = opts.ttlSeconds ?? 120;
  const waitTimeoutMs = opts.waitTimeoutMs ?? 240_000;
  const holder = randomUUID();
  const startedAt = Date.now();

  const tryAcquire = async () => {
    const { data, error } = await rpc.rpc("ci_test_lock_acquire", {
      p_name: OPERATORS_COVERAGE_LOCK,
      p_holder: holder,
      p_ttl_seconds: ttlSeconds,
    });
    if (error) {
      // Fail loudly rather than proceeding unlocked. Running without the lock
      // is the bug; a missing migration should say so, not degrade into the
      // intermittent failure it was meant to remove.
      throw new Error(
        `[operators-lock:${label}] could not reach ci_test_lock_acquire — is 0082 applied to this project? ${error.message}`,
      );
    }
    return data === true;
  };

  while (!(await tryAcquire())) {
    if (Date.now() - startedAt > waitTimeoutMs) {
      throw new Error(
        `[operators-lock:${label}] waited ${Math.round((Date.now() - startedAt) / 1000)}s for ` +
          `"${OPERATORS_COVERAGE_LOCK}" and never got it. Either a run is genuinely slow, or a ` +
          `previous run died holding it — the lease self-expires after ${ttlSeconds}s, so a wait ` +
          `longer than that means someone is actively renewing it.`,
      );
    }
    // Jittered so two waiters released at the same instant do not retry in
    // lockstep forever.
    const delay = 250 + Math.floor(Math.random() * 500);
    await new Promise((r) => setTimeout(r, delay));
  }

  // Renew at a third of the TTL: two renewals may be missed before anyone
  // could steal the lease.
  const heartbeat = setInterval(() => {
    void tryAcquire().catch(() => {
      /* A failed renewal is not fatal on its own — the next tick may succeed,
         and the lease still has most of its TTL left. */
    });
  }, Math.max(1_000, Math.floor((ttlSeconds * 1000) / 3)));
  // Never hold the process open on the heartbeat alone.
  heartbeat.unref?.();

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    const { error } = await rpc.rpc("ci_test_lock_release", {
      p_name: OPERATORS_COVERAGE_LOCK,
      p_holder: holder,
    });
    // A release that fails is worth seeing but must not fail the suite: the
    // lease expires on its own, so the worst case is other runs waiting.
    if (error) console.error(`[operators-lock:${label}] release failed:`, error.message);
  };
}
