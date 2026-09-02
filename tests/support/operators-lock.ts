import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/types";

/**
 * A mutex for suites that assert on a GLOBAL invariant — one that is NOT
 * scoped to rows a single test run created, so per-run naming (RUN_TAG, see
 * tests/support/list-users.ts) cannot protect it. Two kinds of "global" have
 * needed this so far, and the distinction is worth keeping straight:
 *
 *   admin_operators_covered()   asks "does ANY active admin hold `operators`
 *                                anywhere" — a property of every row in
 *                                `admin_users`, not this run's rows.
 *   anonymous_demo_daily        has exactly ONE row for "today", by design —
 *                                the whole point of the table is a single
 *                                shared budget, so there is no run-scoped name
 *                                to give it.
 *
 * See supabase/migrations/0082_ci_test_locks.sql for the lease's own
 * reasoning (why a table, why it expires, why acquire-or-renew is one
 * statement). This file is the TypeScript side: one client function generic
 * over the lock name, plus a named wrapper per invariant so a call site reads
 * "acquire the operators lock" rather than "acquire lock #1".
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
 * side of the invariant is still in the table, which is precisely the
 * situation the lock exists to prevent.
 *
 * Adding a THIRD invariant: add a lock-name constant below (never reuse an
 * existing name — that would serialize two unrelated suites against each
 * other for no reason) and a one-line wrapper calling `acquireLock`, matching
 * `acquireOperatorsLock`'s shape. Do not reach for this for a hazard that
 * per-run naming already solves — see tests/employer/employer-flow.test.ts
 * for that fix instead, and the note in acquireLock's own doc comment below
 * for how to tell the two apart.
 */

/** One lease name per invariant. Reusing a name serializes unrelated suites. */
export const OPERATORS_COVERAGE_LOCK = "admin_operators_coverage";

/**
 * anonymous_demo_daily has exactly one row for "today" — that is the design,
 * not an oversight, so a per-run name cannot scope it the way RUN_TAG scopes
 * `organizations`/`job_postings` rows. Every suite that mutates or resets that
 * row takes this lease first. Reproduced before this existed: a second
 * process's reset (the file's own beforeEach/afterEach, run concurrently)
 * wiped the counter to zero mid-batch and let 4 claims through where the
 * remaining budget was 2 — see the commit that added this lock for the
 * measured numbers.
 */
export const ANONYMOUS_DEMO_DAILY_LOCK = "anonymous_demo_daily_invariant";

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

/**
 * Block until this process holds the NAMED lease, then keep it renewed.
 *
 * The general form both `acquireOperatorsLock` and `acquireAnonymousDemoDailyLock`
 * are one-line wrappers around, so the RPC-calling, retry, jitter, renewal and
 * release logic exists exactly once. Reach for this directly only when adding
 * a THIRD invariant — see this file's header for how to tell a genuine global
 * invariant apart from a per-run naming problem RUN_TAG already solves.
 *
 * Returns the release function. Renewal matters: a suite slower than one TTL
 * would otherwise lose the lock mid-run to a waiter and fail in the confusing
 * way that started all this, rather than failing as a timeout.
 */
export async function acquireLock(
  admin: SupabaseClient<Database>,
  lockName: string,
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
      p_name: lockName,
      p_holder: holder,
      p_ttl_seconds: ttlSeconds,
    });
    if (error) {
      // Fail loudly rather than proceeding unlocked. Running without the lock
      // is the bug; a missing migration should say so, not degrade into the
      // intermittent failure it was meant to remove.
      throw new Error(
        `[lock:${label}] could not reach ci_test_lock_acquire — is 0082 applied to this project? ${error.message}`,
      );
    }
    return data === true;
  };

  while (!(await tryAcquire())) {
    if (Date.now() - startedAt > waitTimeoutMs) {
      throw new Error(
        `[lock:${label}] waited ${Math.round((Date.now() - startedAt) / 1000)}s for ` +
          `"${lockName}" and never got it. Either a run is genuinely slow, or a ` +
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
      p_name: lockName,
      p_holder: holder,
    });
    // A release that fails is worth seeing but must not fail the suite: the
    // lease expires on its own, so the worst case is other runs waiting.
    if (error) console.error(`[lock:${label}] release failed:`, error.message);
  };
}

/** `acquireLock` pinned to the operators-coverage invariant. Existing call sites unchanged. */
export function acquireOperatorsLock(
  admin: SupabaseClient<Database>,
  label: string,
  opts: OperatorsLockOptions = {},
): Promise<() => Promise<void>> {
  return acquireLock(admin, OPERATORS_COVERAGE_LOCK, label, opts);
}

/** `acquireLock` pinned to the anonymous-demo-daily invariant. */
export function acquireAnonymousDemoDailyLock(
  admin: SupabaseClient<Database>,
  label: string,
  opts: OperatorsLockOptions = {},
): Promise<() => Promise<void>> {
  return acquireLock(admin, ANONYMOUS_DEMO_DAILY_LOCK, label, opts);
}
