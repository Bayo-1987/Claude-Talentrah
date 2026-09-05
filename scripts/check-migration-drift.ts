import { committedMigrations } from "./audit-migrations";
import { compareMigrations } from "./migration-drift-compare";

/**
 * The automated half of `npm run audit-migrations` — CI cannot run an MCP
 * connector or put a human in a loop, so this fetches the real answer and
 * fails loudly when a committed migration is missing from production's
 * ledger.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * 0093 landed on `main` with #215, was applied to the CI project as part of
 * building that PR, and was never applied to production — the PR description
 * said "production untouched, migrates on merge," and the merge itself
 * carries no such step. Nothing failed; nothing skipped a check. There was no
 * check. It sat unrecorded until the founder's own direct query against
 * production caught it, by which point two more migrations were queued
 * behind it.
 *
 * ── WHY THIS RUNS ON A SCHEDULE, NOT JUST ON PUSH ──────────────────────────
 *
 * A push-only check cannot catch this failure on its own. Drift appears
 * AFTER a merge: pre-merge, `main` doesn't carry the new migration yet, so
 * there's nothing to detect; post-merge, it's only caught on whatever the
 * next push happens to be. Merge on a Friday, next push on Monday, and the
 * gap is invisible all weekend — which is close to what actually happened
 * with 0093. See `.github/workflows/migration-drift.yml` for the daily
 * schedule this also runs on. GitHub emails the repository's watchers on a
 * FAILED scheduled workflow run automatically; a log line nobody is looking
 * at is exactly what already failed to catch this four times, so the point
 * of the schedule is the loud failure, not just the periodic check.
 *
 * ── WHY THIS DOES NOT USE THE MCP CONNECTOR OR A DIRECT POSTGRES CONNECTION
 *
 * See audit-migrations.ts's own header for why THAT script only prints SQL:
 * production access goes through the MCP connector so a credential never
 * lands on disk. CI has no MCP connector and no human to hand a query to, so
 * this is the one deliberate exception.
 *
 * An earlier version of this file connected directly to Postgres with a role
 * scoped to SELECT on exactly `supabase_migrations.schema_migrations`. That
 * hit a dead end: Supabase's hosted shared pooler doesn't reliably route
 * custom roles through to Postgres — connecting as `migration_auditor`
 * failed with "(ENOTFOUND) tenant/user ... not found", reproduced 8 times
 * over 2 minutes, not a transient propagation delay — and the direct
 * connection (bypassing the pooler) is IPv6-only, which GitHub Actions
 * cannot reach at all (confirmed against Supabase's own docs, which name
 * GitHub Actions specifically as one of the few IPv4-only platforms).
 *
 * This version calls `public.list_applied_migrations()` (migration 0096)
 * over HTTPS instead — a `SECURITY DEFINER` function in `public`, the same
 * pattern this project already uses to reach something the caller's own role
 * can't see directly (`promoted_jobs`, `internal_applicant_counts`,
 * `delete_resume_with_snapshot`), because `supabase_migrations` isn't a
 * schema PostgREST exposes at all. HTTPS has neither the pooler problem nor
 * the IPv4 problem.
 *
 * ── WHAT KEY THIS NEEDS, AND HOW EXPOSED IT IS ─────────────────────────────
 *
 * `MIGRATION_STATUS_JWT` was meant to authenticate as a genuinely separate
 * Postgres role, and hit a real platform wall while this was built: hosted
 * Supabase refuses `grant <new_role> to authenticator` for a project's own
 * owner ("authenticator is a reserved role, only superusers can modify it").
 * Custom PostgREST-reachable roles are not something this platform lets a
 * project provision for itself — see 0096's own header for the full account.
 *
 * What this JWT actually carries is `role: anon` (the only role PostgREST
 * can resolve it to) plus a second, custom claim
 * (`purpose: "migration-status-reader"`) that `list_applied_migrations`
 * checks INSIDE the function body, rejecting every other caller — including
 * a request bearing only the public anon key — with a 403. This is
 * Supabase's own documented pattern for exactly this shape of problem (its
 * Data API guide's "Use additional API keys" section). The PRACTICAL result
 * is what a dedicated role was meant to buy: only a caller holding this
 * specific pre-signed JWT gets data back. It is still true that the data
 * itself (migration filenames already in this repo's own public git
 * history) isn't sensitive — the point of gating it at all was never
 * protecting that list, it's not normalising "the caller only had the anon
 * key" as sufficient in a codebase whose main safety property is RLS
 * discipline. A leaked copy of this JWT can call exactly this one function.
 *
 * `MIGRATION_STATUS_APIKEY` is production's own anon/publishable key,
 * required alongside the JWT: Supabase's gateway checks the `apikey` header
 * itself, separately from the `Authorization` bearer token PostgREST uses to
 * resolve the caller's role, and rejects a request missing a recognised
 * `apikey` regardless of whether the bearer token is otherwise valid. This is
 * the same key already embedded in this app's own public client bundle
 * (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) — it grants nothing on its own here; it
 * only gets the request as far as PostgREST, which then checks the JWT.
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

const projectUrl = process.env.MIGRATION_STATUS_PROJECT_URL;
const apikey = process.env.MIGRATION_STATUS_APIKEY;
const jwt = process.env.MIGRATION_STATUS_JWT;

if (!projectUrl || !apikey || !jwt) {
  console.error(
    "MIGRATION_STATUS_PROJECT_URL, MIGRATION_STATUS_APIKEY and MIGRATION_STATUS_JWT must all be set — nothing to check against.",
  );
  process.exit(1);
}

interface AppliedMigrationRow {
  name: string;
}

async function fetchAppliedMigrationNames(): Promise<string[]> {
  const res = await fetch(`${projectUrl}/rest/v1/rpc/list_applied_migrations`, {
    method: "POST",
    headers: {
      apikey: apikey!,
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    // PostgREST RPC calls take a JSON body of arguments — this function
    // takes none, but an empty object is still required, not an empty body.
    body: "{}",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`list_applied_migrations returned ${res.status}: ${body}`);
  }

  const rows = (await res.json()) as AppliedMigrationRow[];
  return rows.map((r) => r.name);
}

const committed = committedMigrations();
const applied = await fetchAppliedMigrationNames();
const results = compareMigrations(committed, applied);
const missing = results.filter((r) => r.status === "MISSING");

for (const r of results) {
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
  console.log(`\nAll ${committed.length} committed migrations are accounted for on production.`);
}
