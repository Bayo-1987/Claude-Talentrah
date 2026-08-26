import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/types";
import { deleteOrgsCascade } from "./delete-orgs";
import { selectFixtureOrgs } from "./fixture-orgs";

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

export async function teardown(): Promise<void> {
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
