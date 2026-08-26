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
 * `deleteTestOrgs` in each suite is the primary mechanism and it works: run
 * tests/billing/ad-campaigns.test.ts on its own and the organisation count is
 * unchanged, 23 before and 23 after.
 *
 * But an `afterAll` only runs if the file gets that far, and it only finishes
 * if it is given the time. Measured, not theorised — a full-suite run that hit
 * Supabase's auth rate limit (the condition CLAUDE.md already documents as
 * "not a real failure") left 21 organisations behind, all from that one file:
 *
 *     fixture_kind   n   first       last
 *     Campaign Co   20   11:59:16    11:59:47
 *     Outsider Co    1   11:59:36    11:59:36
 *
 * while the same suite passing cleanly leaked nothing. A teardown cannot clean
 * up after a failure that prevents the teardown from running — hook timeouts,
 * a killed worker, Ctrl-C, a rate-limited run aborted partway. Those are
 * exactly the runs that leak, and exactly the runs a per-file hook cannot
 * cover.
 *
 * So this runs ONCE after the whole run, regardless of what any individual
 * file did, and sweeps by the same conservative allowlist the one-time purge
 * script uses. It is a safety net, not the mechanism: a suite that stops
 * calling `deleteTestOrgs` should still be treated as a bug, which is why the
 * sweep is loud about what it found.
 *
 * ── Why it does not fail the run when it finds residue ────────────────────
 *
 * Residue after an INTERRUPTED run is expected — that is the case this exists
 * for. Failing on it would turn "your run was rate-limited" into two failures
 * instead of one. It DOES fail when it cannot delete, because a sweep that
 * cannot sweep is the condition that let 324 organisations accumulate.
 */

export async function teardown(): Promise<void> {
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

  console.warn(
    `\n[global-teardown] ${stragglers.length} fixture organisation(s) survived their suite's afterAll ` +
      `— sweeping. This is expected after an interrupted or rate-limited run; ` +
      `if it happens on a clean run, a suite is missing deleteTestOrgs.`,
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
