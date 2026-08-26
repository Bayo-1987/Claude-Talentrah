/**
 * One-time purge of fixture organisations left in the live project.
 *
 * ── Why this was needed ───────────────────────────────────────────────────
 *
 * Seven suites created organisations, all seven had a teardown, and none of
 * them ever worked: `job_postings.organization_id` is NO ACTION, so Postgres
 * refused every `delete from organizations`, and supabase-js reports that by
 * RESOLVING with `{ data: null, error }` rather than throwing. The error was
 * discarded at all seven call sites, so the leak rate was 100% per run and
 * nothing ever failed. See tests/support/delete-orgs.ts for the full write-up.
 *
 * By the time it was found the live project held 314 organizations of which
 * 312 were fixtures, 318 ad_campaigns (117 `active`), 192 ad_wallets and 385
 * ledger rows. That mattered beyond untidiness: the daily charge cron would
 * have rediscovered and charged those 117 campaigns every morning, so every
 * future run summary would report fake activity.
 *
 * ── Safety ────────────────────────────────────────────────────────────────
 *
 * This deletes from production. There is no staging database (CLAUDE.md), so
 * three guards, in order of how much they are relied on:
 *
 *  1. DRY RUN BY DEFAULT. Prints the exact set and exits. `--apply` deletes.
 *     Re-running is safe: selection is by pattern, so a second run simply
 *     matches nothing.
 *  2. AN ALLOWLIST, NOT A DENYLIST. Rows are selected by fixture patterns that
 *     match what the suites literally construct. A row that matches nothing is
 *     never touched, so an organisation created by a future feature is safe by
 *     default rather than safe by having been remembered here.
 *  3. A PROTECTED-NAME ASSERTION that aborts the whole run if the selection
 *     ever contains a known-real organisation. Belt and braces against a
 *     pattern being widened carelessly later — `camp-%` would have been a
 *     tempting shortening of `camp-%.example`, and `zariadigital.example` is
 *     itself a `.example` domain, so "just match .example" is wrong too.
 *
 * Run: npx tsx scripts/cleanup-test-orgs.ts [--apply]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";
import { selectFixtureOrgs, type FixtureOrg } from "../tests/support/fixture-orgs";

const db = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/**
 * Patterns and the protected-name assertion live in
 * tests/support/fixture-orgs.ts, shared with the per-suite teardown and the
 * global sweep so the three cannot drift. `selectFixtureOrgs` throws if the
 * selection ever contains a known-real organisation.
 */
// olderThanMs = 0: the operator is deliberately clearing everything, and the
// dry run has already shown them exactly what will go. The global sweep uses
// the default age gate instead, because it can run while another suite is live.
const selectFixtures = (): Promise<FixtureOrg[]> => selectFixtureOrgs(db as never, 0);

async function main() {
  const apply = process.argv.includes("--apply");

  const { count: totalBefore } = await db
    .from("organizations")
    .select("id", { count: "exact", head: true });

  const fixtures = await selectFixtures();

  const ids = fixtures.map((o) => o.id);
  const { count: campaigns } = await db
    .from("ad_campaigns")
    .select("id", { count: "exact", head: true })
    .in("organization_id", ids.slice(0, 100));

  console.log(`organizations total ....... ${totalBefore}`);
  console.log(`matched as fixtures ....... ${fixtures.length}`);
  console.log(`would survive ............. ${(totalBefore ?? 0) - fixtures.length}`);
  console.log(`(campaigns under first 100 fixture orgs: ${campaigns})`);

  const byShape = new Map<string, number>();
  for (const o of fixtures) {
    const shape = (o.domain ?? o.name).replace(/[0-9a-f]{6,}/gi, "<hex>");
    byShape.set(shape, (byShape.get(shape) ?? 0) + 1);
  }
  console.log("\nmatched, by shape:");
  for (const [s, n] of [...byShape].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${s}`);
  }

  if (!apply) {
    console.log("\nDRY RUN — nothing deleted. Re-run with --apply to delete.");
    return;
  }

  /*
   * Passes, not one shot. The first real run of this deleted 315 of 324 and
   * left 9 behind — the final check below is what caught it, rather than the
   * run reporting success. Rather than leave "notice the mismatch and re-run"
   * as an operator's job, converge here and report each pass. Bounded so a
   * genuinely undeletable row fails loudly instead of spinning.
   */
  let pass = 0;
  let pending = ids;
  while (pending.length && pass < 5) {
    pass += 1;
    console.log(`\npass ${pass}: deleting ${pending.length} organisations and dependent rows...`);
    await deleteOrgsCascade(db, pending);
    pending = (await selectFixtures()).map((o) => o.id);
    console.log(`pass ${pass}: ${pending.length} fixture organisations still matching`);
  }

  const remaining = await selectFixtures();
  const { count: totalAfter } = await db
    .from("organizations")
    .select("id", { count: "exact", head: true });
  console.log(`\norganizations remaining ... ${totalAfter}`);
  console.log(`fixtures remaining ........ ${remaining.length}`);
  if (remaining.length) {
    throw new Error(
      `${remaining.length} fixture organisations survived ${pass} passes — investigate before rerunning`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
