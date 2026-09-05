/**
 * One-time backfill: re-run the updated onsite inference against every
 * already-ingested `job_postings` row whose `work_type` is still NULL.
 *
 * ── WHY A BACKFILL AT ALL ─────────────────────────────────────────────────
 *
 * `inferWorkType` (src/lib/jobs/extract-jd.ts, feeds Greenhouse) and
 * `mapWorkType` (src/lib/jobs/sources/schema-org.ts, feeds the Workable
 * sources) both gained a branch that asserts `onsite` from a real physical
 * location with no remote/hybrid signal, instead of falling through to
 * `undefined`. That only affects postings ingested AFTER the fix ships,
 * unless the historical rows are re-run through the same functions —
 * measured on production before this ran: 299 of 457 open postings (65.4%)
 * were `work_type IS NULL`, almost all of them jobs this new logic can now
 * read correctly.
 *
 * ── WHY THIS SCRIPT, NOT A HAND-ROLLED UPDATE ────────────────────────────
 *
 * The task this shipped under is explicit: if the inference isn't trustworthy
 * enough to re-run against existing rows, it isn't trustworthy enough to run
 * at ingest time either. So this calls the REAL exported `inferWorkType` for
 * Greenhouse rows — same function, same inputs (title, location) it would
 * receive from a live board response.
 *
 * schema-org rows can't be replayed quite that literally: `mapWorkType`
 * takes the raw JSON-LD shape (`jobLocationType`, `jobLocation.address`),
 * and job_postings only stores the derived `location` string, not that raw
 * shape. The reconstruction used here is exact, not approximate, for the
 * specific rows this script touches (`work_type IS NULL`):
 *
 *   `mapWorkType` returns NULL only when `jobLocationType !== "TELECOMMUTE"`
 *   AND `hasUsableAddress(block)` is false. `formatLocation` (same file)
 *   returns a value in EXACTLY the same non-TELECOMMUTE case whenever
 *   `hasUsableAddress(block)` is true, and `undefined` otherwise — see that
 *   function's own header, which states the two share one definition for
 *   this reason. So for a row that is already `work_type IS NULL` coming out
 *   of schema-org ingestion, `location IS NOT NULL` and `hasUsableAddress`
 *   being true are the same fact. This script uses the stored `location`
 *   column as that proxy — it is not a heuristic, it is the same predicate
 *   read back through the one column it was already recorded in.
 *
 * ── WRITE BACK ONLY WHAT CHANGES, IDEMPOTENT ─────────────────────────────
 *
 * Only rows whose computed value differs from the stored value are updated,
 * and only `work_type IS NULL` rows are ever candidates — a second run finds
 * nothing left to change and updates zero rows. Scoped to `status = 'open'`:
 * closed postings are not user-visible anywhere a work-type filter reads, so
 * there is nothing this backfill would fix for them today (see the PR
 * description for the one-time exception already found among closed rows,
 * which needed a test, not a data fix).
 *
 * ── HOW THIS WAS ACTUALLY RUN AGAINST PRODUCTION ─────────────────────────
 *
 * Per CLAUDE.md's "one-off production work" convention, the live run against
 * `nytwbbzfpytctjsoczzq` went through the Supabase MCP connector's
 * `execute_sql`, not by invoking this file with a production credential in
 * `.env.local` (which currently points at the paused CI project — see
 * db-target.ts). The SQL run there implements the identical two rules above
 * (Greenhouse: `inferWorkType`'s NON_LOCATION_VALUES denylist; schema-org:
 * "location is not null"); this file is the reviewable TypeScript definition
 * of that same logic, runnable against any project reachable from
 * `.env.local` (a local stack, or a future staging project) via
 * `npx tsx scripts/backfill-work-type.ts` (`--apply` to write; dry run by
 * default, same convention as cleanup-test-orgs.ts).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { inferWorkType } from "../src/lib/jobs/extract-jd";
import { announceDbTarget } from "./db-target";

type WorkType = Database["public"]["Enums"]["work_type"];

const db = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

interface Candidate {
  id: string;
  title: string;
  location: string | null;
  external_source: string | null;
}

/** See the file header's "WHY THIS SCRIPT" section for why this is an exact
 * reconstruction of `mapWorkType`, not an approximation, for rows already
 * known to have `work_type IS NULL`. */
function inferSchemaOrgOnsite(location: string | null): WorkType | undefined {
  return location ? "onsite" : undefined;
}

function computeNewWorkType(row: Candidate): WorkType | undefined {
  if (row.external_source === "greenhouse") {
    return inferWorkType(row.title, row.location ?? undefined);
  }
  if (row.external_source?.startsWith("schema-org:")) {
    return inferSchemaOrgOnsite(row.location);
  }
  // Lever already reads a real structured field at ingest time and has no
  // NULL rows to backfill; anything else (organisation-posted jobs,
  // external_source null) never went through either inference function and
  // is out of scope for this backfill.
  return undefined;
}

async function main() {
  announceDbTarget("backfill-work-type");
  const apply = process.argv.includes("--apply");

  const { data, error } = await db
    .from("job_postings")
    .select("id, title, location, external_source")
    .eq("status", "open")
    .is("work_type", null)
    .range(0, 9999); // explicit, not the client's default page size — see CLAUDE.md on truncated results
  if (error) throw error;

  const rows = data ?? [];
  console.log(`open, work_type IS NULL: ${rows.length} candidate rows`);

  const changes = rows
    .map((row) => ({ row, newWorkType: computeNewWorkType(row) }))
    .filter((c): c is { row: Candidate; newWorkType: WorkType } => c.newWorkType !== undefined);

  const bySource = new Map<string, number>();
  for (const { row } of changes) {
    const key = row.external_source ?? "(null)";
    bySource.set(key, (bySource.get(key) ?? 0) + 1);
  }

  console.log(`\nwould change: ${changes.length} of ${rows.length}`);
  for (const [source, count] of [...bySource].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${source}`);
  }

  if (!apply) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to write.");
    return;
  }

  let written = 0;
  for (const { row, newWorkType } of changes) {
    const { error: updateError } = await db
      .from("job_postings")
      .update({ work_type: newWorkType })
      .eq("id", row.id)
      .is("work_type", null); // still-NULL guard: never overwrite a value another writer set meanwhile
    if (updateError) throw updateError;
    written += 1;
  }

  console.log(`\nwrote work_type on ${written} rows.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
