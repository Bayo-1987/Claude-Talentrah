import postgres from "postgres";
import { buildQuery, committedMigrations } from "./audit-migrations";

/**
 * The automated half of `npm run audit-migrations` — CI cannot run an MCP
 * connector or put a human in a loop, so this connects for real and fails
 * loudly when a committed migration is missing from production's ledger.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * 0093 landed on `main` with #215, was applied to the CI project as part of
 * building that PR, and was never applied to production — the PR description
 * said "production untouched, migrates on merge", and the merge itself
 * carries no such step. Nothing failed; nothing skipped a check. There was no
 * check. It sat unrecorded until the founder's own direct query against
 * production caught it, by which point #220 and #222 had two more migrations
 * queued behind it. This runs on every push to `main` specifically so that
 * gap is a red, unmissable CI status rather than something a person has to
 * remember to go looking for.
 *
 * ── WHY THIS DOES NOT USE THE MCP CONNECTOR OR A FULL CREDENTIAL ───────────
 *
 * See audit-migrations.ts's own header for why THAT script only prints SQL:
 * production access goes through the MCP connector so a credential never
 * lands on disk. CI has no MCP connector and no human to hand a query to, so
 * this is the one deliberate exception — reached with `migration_auditor`, a
 * role scoped to SELECT on exactly `supabase_migrations.schema_migrations`
 * and nothing else (verified directly: it cannot read a single `public`
 * table). Losing this credential exposes a list of migration names that are
 * already public in this repo's own history — not a working key to anything
 * that matters.
 *
 * ── WHY THE SHARED POOLER, NOT A DIRECT CONNECTION ─────────────────────────
 *
 * GitHub Actions runners are IPv4-only; Supabase's direct connection
 * (`db.<ref>.supabase.co:5432`) is IPv6-only without the paid IPv4 add-on.
 * Supavisor's transaction-mode pooler (`:6543`) is IPv4 on every plan,
 * confirmed against this project's own DNS before wiring this in.
 *
 * ── WHAT A FAILURE MEANS, AND WHAT IT DOES NOT ─────────────────────────────
 *
 * A migration listed here as MISSING was never recorded as applied to
 * PRODUCTION — it says nothing about the CI project, which this script does
 * not check (CI's own ledger has a documented, tolerated gap of its own; see
 * audit-migrations.ts's KNOWN_ALIASES and its header on the 25-row gap for
 * schema demonstrably present). Fix it by applying the migration to
 * production through the MCP connector, the same as any other migration —
 * this script only detects the gap, it does not close it.
 */

const databaseUrl = process.env.MIGRATION_AUDIT_DATABASE_URL;
if (!databaseUrl) {
  console.error("MIGRATION_AUDIT_DATABASE_URL is not set — nothing to check against.");
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  ssl: "require",
  // Supavisor transaction mode does not support prepared statements.
  prepare: false,
  connect_timeout: 15,
  max: 1,
});

interface Row {
  migration: string;
  status: "applied" | "applied under a documented alias" | "applied without its numeric prefix" | "MISSING";
}

try {
  const names = committedMigrations();
  const query = buildQuery(names);
  const rows = (await sql.unsafe(query)) as unknown as Row[];

  const missing = rows.filter((r) => r.status === "MISSING");

  for (const r of rows) {
    console.log(`${r.status === "MISSING" ? "✗" : "✓"} ${r.migration} — ${r.status}`);
  }

  if (missing.length > 0) {
    console.error(
      `\n${missing.length} migration${missing.length === 1 ? " is" : "s are"} committed on main but not recorded as applied on production:\n` +
        missing.map((r) => `  - ${r.migration}`).join("\n") +
        `\n\nApply through the Supabase MCP connector against nytwbbzfpytctjsoczzq, then re-run.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${names.length} committed migrations are accounted for on production.`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
