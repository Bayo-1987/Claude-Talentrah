import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/types";
import { deleteOrgsCascade } from "./delete-orgs";
import { selectFixtureOrgs, SWEEP_STALE_AFTER_MS } from "./fixture-orgs";
import {
  TEST_ACCOUNT_DOMAIN,
  assertNoProtectedAccounts,
  type TestAccount,
} from "./fixture-accounts";

/**
 * The backstop under every suite's own `afterAll`.
 *
 * ── Why a per-suite teardown is not enough ────────────────────────────────
 *
 * `deleteTestOrgs` in each suite is the primary mechanism, and the delete
 * itself is proven correct: 21 organisations each with a blocking
 * `job_posting` — the exact shape and scale ad-campaigns.test.ts produces —
 * are removed in 1.7s, verified 0 remaining by direct SQL.
 *
 * It still is not sufficient, and the honest version of why is that the
 * failure is CONDITIONAL ON SCALE and the mechanism is NOT pinned down:
 *
 *   | configuration                                   | leaked |
 *   |-------------------------------------------------|--------|
 *   | ad-campaigns.test.ts alone                      | 0      |
 *   | 4 org-creating suites, 2 rate-limit failures    | 0      |
 *   | full 33-file run, all files reported passing    | 21     |
 *   | full 33-file run, rate-limited                  | 42     |
 *
 * The leak is always a whole file's worth of fixtures (20 orgs + 1 outsider =
 * one run of ad-campaigns.test.ts), which says the hook did not complete
 * rather than that it deleted the wrong rows. What has NOT been established is
 * why it does not complete at full parallelism — the obvious candidates
 * (PostgREST row caps, `db_max_rows`) were checked and ruled out, and the
 * runs that would narrow it further are themselves rate-limited by the auth
 * API this suite hammers.
 *
 * That unknown is precisely the argument FOR a backstop rather than against
 * one. There is no staging database (CLAUDE.md); the cost of a teardown that
 * silently does not run is a production table that fills up, which is exactly
 * how 324 organisations accumulated. A sweep that runs once at the end,
 * unconditionally, does not need the mechanism explained to be correct.
 *
 * Treat a straggler on a CLEAN run as a bug in that suite, not as something
 * the sweep exists to absorb — the breakdown it prints names the suite.
 *
 * ── Why it does not fail the run when it finds residue ────────────────────
 *
 * Residue after an INTERRUPTED run is expected — that is the case this exists
 * for. Failing on it would turn "your run was rate-limited" into two failures
 * instead of one. It DOES fail when it cannot delete, because a sweep that
 * cannot sweep is the condition that let 324 organisations accumulate.
 */

async function sweep(): Promise<void> {
  if (process.env.TALENTRAH_SKIP_GLOBAL_SWEEP === "1") {
    // Debug escape hatch: leaves stragglers in place so you can inspect WHICH
    // suite produced them and when. Never set in CI — the sweep is the reason
    // an interrupted run no longer fills the live project.
    console.warn("[global-teardown] skipped (TALENTRAH_SKIP_GLOBAL_SWEEP=1)");
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // No credentials means no DB-backed suite ran either. Nothing to sweep.
    return;
  }

  const db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await sweepStaleAccounts(db);

  // selectFixtureOrgs asserts no protected organisation is in the selection and
  // throws if one is, so a widened pattern fails here rather than deleting
  // Zaria Digital or Fatishcakes.
  const stragglers = await selectFixtureOrgs(db as never);
  if (!stragglers.length) return;

  /*
   * Grouped by fixture kind, because "21 organisations survived" does not tell
   * you which suite to go and fix — and that was the first question asked of
   * this message the first time it fired.
   */
  const byKind = new Map<string, number>();
  for (const o of stragglers) {
    const kind = o.name.replace(/[0-9a-f]{6,}$/i, "").trim() || o.name;
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }
  const breakdown = [...byKind]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, n]) => `${n}x ${kind}`)
    .join(", ");

  console.warn(
    `\n[global-teardown] ${stragglers.length} fixture organisation(s) survived their suite's afterAll ` +
      `— sweeping. Breakdown: ${breakdown}. ` +
      `Expected after an interrupted or rate-limited run; on a CLEAN run it means ` +
      `that suite's teardown is not doing its job.`,
  );

  await deleteOrgsCascade(db, stragglers.map((o) => o.id));

  const left = await selectFixtureOrgs(db as never);
  if (left.length) {
    throw new Error(
      `[global-teardown] ${left.length} fixture organisation(s) could not be deleted. ` +
        `Run \`npm run cleanup-test-orgs\` and investigate — this is how residue accumulates.`,
    );
  }
  console.warn(`[global-teardown] swept ${stragglers.length}; 0 remaining.\n`);
}

/**
 * Stale throwaway auth accounts, ported from PR #56.
 *
 * ORGANISATIONS ARE SWEPT SEPARATELY AND AFTER, deliberately: `organizations`
 * references `profiles(id)` on `created_by`, and deleting an account cascades
 * its profile. Doing accounts first and orgs second means an account whose
 * organisation is still present is left for the org sweep to unblock on the
 * next run rather than failing here — which is why this reports and returns
 * instead of throwing.
 *
 * `listUsers()` is PAGINATED. Calling it with no arguments returns only the
 * first page, which is the bug that broke the seed (PR #53) — and a sweep
 * reading one page would leave exactly the accounts that pushed the project
 * past the page boundary, i.e. the ones that matter.
 */
async function sweepStaleAccounts(db: ReturnType<typeof createClient<Database>>): Promise<void> {
  const cutoff = Date.now() - SWEEP_STALE_AFTER_MS;
  const candidates: TestAccount[] = [];

  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.warn(`[global-teardown] could not list accounts to sweep: ${error.message}`);
      return;
    }
    for (const u of data.users) {
      const email = u.email ?? "";
      if (!email.toLowerCase().endsWith(TEST_ACCOUNT_DOMAIN)) continue;
      candidates.push({ id: u.id, email, created_at: u.created_at });
    }
    if (data.users.length < perPage) break;
  }

  // Protected first, age second — see fixture-accounts.ts on why this order.
  assertNoProtectedAccounts(candidates);

  const stale = candidates.filter((a) => new Date(a.created_at).getTime() < cutoff);
  if (!stale.length) return;

  const failures = (
    await Promise.all(
      stale.map((a) =>
        db.auth.admin
          .deleteUser(a.id)
          .then((r) => (r.error ? `${a.email}: ${r.error.message}` : null))
          .catch((e) => `${a.email}: ${e instanceof Error ? e.message : String(e)}`),
      ),
    )
  ).filter((f): f is string => f !== null);

  console.warn(
    `[global-teardown] swept ${stale.length - failures.length}/${stale.length} stale ` +
      `${TEST_ACCOUNT_DOMAIN} accounts` +
      (failures.length
        ? ` — ${failures.length} could not be deleted, left for a later run. First: ${failures[0]}`
        : ""),
  );
}

/**
 * The exported hook. Everything above runs inside it, and the only reason this
 * wrapper exists is that A THROW FROM `globalSetup` TEARDOWN DOES NOT FAIL THE
 * RUN.
 *
 * Measured both ways, because the whole point of this branch is not trusting
 * that an error surfaced. Throwing from an unwrapped exported `teardown`:
 *
 *     Tests  44 passed (44)
 *     error during close Error: SYNTHETIC unwrapped throw
 *     UNWRAPPED EXIT=0
 *
 * One line, below the summary, easy to scroll past — and a GREEN run. With the
 * wrapper:
 *
 *     [global-teardown] FAILED: SYNTHETIC: pretend the sweep could not delete
 *     [global-teardown] The sweep is what keeps fixture rows out of the live
 *     project ... Run `npm run cleanup-test-orgs` and fix the cause ...
 *     VITEST EXIT=1
 *
 * A safety assertion nobody can see is not a safety assertion. Leaving it
 * unwrapped would have reintroduced the exact discarded-error class this
 * entire branch exists to fix, inside the code that fixes it.
 *
 * So: catch, print to stderr, and set `process.exitCode` by hand. The run's own
 * results are already printed by then, so this turns a silent swallow into a
 * red run without pretending a test failed.
 */
export async function teardown(): Promise<void> {
  try {
    await sweep();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `\n[global-teardown] FAILED: ${message}\n` +
        `[global-teardown] The sweep is what keeps fixture rows out of the live project ` +
        `(there is no staging database). Run \`npm run cleanup-test-orgs\` and fix the cause ` +
        `before the next run.\n`,
    );
    process.exitCode = 1;
  }
}
