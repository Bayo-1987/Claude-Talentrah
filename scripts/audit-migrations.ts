import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Emit the SQL that answers "which committed migrations are not recorded as
 * applied here" — to be run against either project through the Supabase MCP
 * connector.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * 0066 sat committed-but-unapplied on production for hours. Its code shipped,
 * the column was never created, and the feature silently did nothing on the
 * live site. Nobody noticed because there was no diff anyone could run and
 * believe: `schema_migrations` on production holds three naming conventions,
 * and on CI it is missing 25 rows for schema that is demonstrably present. A
 * naive comparison drowns one real gap in eleven false ones — which is worse
 * than no comparison, because it teaches people to ignore the output.
 *
 * ── WHY IT PRINTS SQL INSTEAD OF CONNECTING ───────────────────────────────
 *
 * Two reasons, one discovered the hard way.
 *
 * The first version used the service-role client and failed: PostgREST exposes
 * only the schemas it is configured for, and `supabase_migrations` is not one
 * of them — `Invalid schema: supabase_migrations`. Reaching it would mean
 * adding a `public` function to wrap a tooling query, which is real schema
 * surface for a housekeeping concern.
 *
 * The second reason is the one that makes this the better design anyway.
 * PRODUCTION is the project that most needs auditing, and CLAUDE.md is
 * explicit that production work goes through the MCP connector precisely so a
 * credential never lands on disk. A script that connected would either be
 * useless for production or would want the one key nobody should be storing.
 * Printing SQL needs no credential at all, and audits either project.
 *
 * check-migration-drift.ts (same directory) is the one deliberate exception —
 * CI cannot run an MCP connector or a human in a loop, so 0093 sat
 * unrecorded on production from #215's merge until the founder's own direct
 * query caught it. That script connects with a role scoped to SELECT on
 * exactly `supabase_migrations.schema_migrations` and nothing else — not "the
 * one key nobody should be storing" this comment warns about, which is
 * service-role or superuser reach. This file's own reasoning stands for every
 * OTHER case: a human or an interactive agent has the MCP connector and
 * should keep using it.
 *
 * ── WHY IT DOES NOT "FIX" THE LEDGER ──────────────────────────────────────
 *
 * Rewriting the recorded names to match the filenames was the obvious
 * alternative and it is the wrong one. The repo's position, stated in three
 * migration headers, is that an applied migration is history: 0060 kept its
 * colliding number because its header carries an md5 of the recorded
 * statements, 0061 documents its own name mismatch as "cosmetic and
 * deliberate" and says in capitals not to re-apply it to fix the name, and
 * 0062 exists at all because editing an applied migration was refused.
 *
 * The problem was never that the record is untidy. It is that nothing could
 * read it. This reads it.
 *
 *   npm run audit-migrations           # prints the query
 *   npm run audit-migrations -- --list # prints what it considers committed
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * Not a migration, and must not be reported as unapplied. 0000 is a snapshot
 * of the schema as it stood at 0026, written so later changes have a
 * reviewable baseline; its own header says it is not to be run, and running it
 * would fail on every object it describes.
 */
export const NOT_A_MIGRATION = new Set(["0000_baseline_schema"]);

/**
 * Recorded under a name that is not its filename, deliberately.
 *
 * Only 0061, and only because its file explains why: it shipped as
 * 0060_course_recommendations, collided with 0060_admin_identity from another
 * branch the same morning, and was renumbered AFTER being applied to both
 * projects. Supabase keys the table on `version`, and the two 0060 rows carry
 * different versions, so nothing is ambiguous — only the label is stale,
 * permanently and on purpose.
 *
 * An entry here claims a mismatch was DECIDED rather than missed. Adding one
 * to silence this script would be the failure it exists to prevent, so each
 * needs its reasoning written above it.
 */
export const KNOWN_ALIASES: Record<string, string> = {
  "0061_course_recommendations": "0060_course_recommendations",
  /*
   * Applied to both projects under its own working title rather than its
   * final filename — this repo's migration history briefly dropped, then
   * restored, admin MFA (#143), and 0071 is the drop. Confirmed present on
   * both production and CI as `drop_admin_mfa_0071`, and
   * `admin_users.mfa_enrolled_at` confirmed absent from both — this is a
   * label mismatch, not an unrecorded schema change. Found by running this
   * script's own query for real against production while building
   * check-migration-drift.ts (2026-09-05): it reported 0071 as MISSING with
   * no alias entry, which would have been this check's first false positive
   * on the very PR that added it.
   */
  "0071_drop_admin_mfa": "drop_admin_mfa_0071",
  /*
   * Both applied to CI as 0076/0077 before `0076_admin_create_operator`
   * landed on main. Each was legitimately its number when written; main's
   * arrived first, so the blog pair moved up by one. Production received them
   * under the correct names, so this alias is CI-only — which is why the two
   * projects disagree on the label and agree on the schema.
   */
  "0077_blog_permission": "0076_blog_permission",
  "0078_grant_blog_permission": "0077_grant_blog_permission",
};

export function committedMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/\.sql$/, ""))
    .filter((n) => !NOT_A_MIGRATION.has(n))
    .sort();
}

export function buildQuery(names: string[]): string {
  const values = names.map((n) => `('${n.replace(/'/g, "''")}')`).join(",\n    ");
  const aliases = Object.entries(KNOWN_ALIASES)
    .map(([file, recorded]) => `('${file}','${recorded}')`)
    .join(", ");

  return `-- Committed migrations vs what this project records as applied.
-- Generated by scripts/audit-migrations.ts — run through the Supabase MCP
-- connector against production (nytwbbzfpytctjsoczzq) or CI (dozaffzgqkbarxtlclsj).
--
-- A row of 'MISSING' means the LEDGER IS SILENT, not that the change is absent.
-- Check for the schema itself — the table, column, function or grant the
-- migration creates — before concluding it never ran. A project restored from a
-- snapshot rather than replayed has the schema WITHOUT the record, which is
-- exactly the state CI is in for 0026-0050.
with committed(name) as (values
    ${values}
),
alias(file_name, recorded_name) as (values ${aliases}),
applied as (select name from supabase_migrations.schema_migrations where name is not null)
select
  c.name as migration,
  case
    when exists (select 1 from applied a where a.name = c.name)
      then 'applied'
    when exists (
      select 1 from alias al join applied a on a.name = al.recorded_name
      where al.file_name = c.name
    ) then 'applied under a documented alias'
    when exists (
      select 1 from applied a
      where regexp_replace(a.name, '^[0-9]{4}_', '') = regexp_replace(c.name, '^[0-9]{4}_', '')
    ) then 'applied without its numeric prefix'
    else 'MISSING'
  end as status
from committed c
order by
  case when exists (select 1 from applied a where a.name = c.name) then 2 else 1 end,
  c.name;`;
}

// Guarded so check-migration-drift.ts can import committedMigrations/buildQuery
// without also triggering this file's own CLI output as a side effect.
// fileURLToPath, not a raw string compare against import.meta.url: a space
// anywhere in the path (this repo's own directory has one) URL-encodes to
// %20 in the URL form but not in process.argv[1], which made a naive
// `file://${process.argv[1]}` comparison false even when run directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const names = committedMigrations();

  if (process.argv.includes("--list")) {
    console.log(names.join("\n"));
    console.log(`\n${names.length} committed migrations (excluding the baseline snapshot)`);
  } else {
    console.log(buildQuery(names));
  }
}
