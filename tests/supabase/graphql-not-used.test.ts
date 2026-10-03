/**
 * send-514 — the app has no GraphQL consumer, so dropping pg_graphql (0211) changes nothing in src or the client.
 * docs/pg-graphql-investigation.md found no caller by four independent methods; this keeps the repo side of that true.
 */
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

describe("no GraphQL consumer in the app", () => {
  it("nothing under src, e2e or scripts calls /graphql/v1 or imports a GraphQL client", () => {
    const hits = execSync(
      `git grep -n -i -E "graphql/v1|from [\\"']graphql|@apollo/client|urql|graphql-request|pg_graphql" -- src e2e scripts ':!scripts/audit-migrations.ts' || true`,
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    expect(hits).toEqual([]);
  });

  it("package.json has no GraphQL client dependency", () => {
    const pkg = execSync("git show HEAD:package.json", { encoding: "utf8" });
    expect(pkg).not.toMatch(/"(graphql|graphql-request|@apollo\/client|urql|graphql-tag)"/);
  });
});

describe("migration 0211 shape", () => {
  const sql = readFileSync("supabase/migrations/0211_definer_and_graphql_hardening.sql", "utf8");
  const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

  it("revokes the six trigger functions from public, anon and authenticated, never from service_role", () => {
    const fns = ["enforce_ad_campaign_transition", "enforce_application_stage_transition", "ensure_email_preferences", "invalidate_match_scores_on_jd_change", "match_scores_prune_on_posting_closed", "stamp_employer_applicant_status"];
    for (const f of fns) expect(code).toContain(`revoke execute on function public.${f}() from public, anon, authenticated;`);
    expect(code).not.toMatch(/revoke[^;]*service_role/i);
  });

  it("revokes referral_leaderboard from anon and keeps authenticated", () => {
    expect(code).toMatch(/revoke execute on function public\.referral_leaderboard\(timestamptz, timestamptz, integer\) from public, anon;/);
    expect(code).toMatch(/grant execute on function public\.referral_leaderboard\(timestamptz, timestamptz, integer\) to authenticated;/);
  });

  it("drops pg_graphql here, not in the baseline (the baseline still creates it)", () => {
    expect(code).toMatch(/drop extension if exists pg_graphql;/);
    expect(readFileSync("supabase/migrations/0000_baseline_schema.sql", "utf8")).toMatch(/create extension if not exists pg_graphql/);
  });

  it("leaves the functions the owner decided to keep untouched", () => {
    for (const f of ["internal_applicant_counts", "email_unsubscribe", "is_org_member", "is_valid_referral_code", "list_applied_migrations", "superseded_job_target"]) {
      expect(code, f).not.toContain(f);
    }
  });
});
