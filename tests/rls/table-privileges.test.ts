/**
 * Standing test for migration 0227_public_tables_unused_privileges.
 *
 * TRUNCATE, REFERENCES, TRIGGER and MAINTAIN are never used by the app (the Data API only issues SELECT, INSERT, UPDATE and DELETE) and, unlike those four, are not limited by row-level security. anon and authenticated must therefore not hold
 * them on any public table, and a table the postgres role creates later must not get them from the default privileges. This holds all three places the grant can come from: the table's own ACL, a column-level ACL (REFERENCES can be granted
 * per column), and pg_default_acl for the postgres role in schema public (supabase_admin's defaults are deliberately out of scope: a table that role creates is not covered, and the 0227 post-apply check lists any public table not owned by postgres).
 * It also holds that count_rewarded_referrals_last_30d and check_and_activate_referral are not executable by anon or authenticated (production already has it so).
 *
 * It reads public.table_privilege_snapshot() (service_role only), which reads the catalogs inside Postgres with aclexplode: PostgREST does not expose pg_catalog, and information_schema (what data_api_grants_snapshot() reads) does not list MAINTAIN.
 * Runs in CI against the database every migration has been applied to. The rule itself is tested without a database, with planted grants, in tests/rls/unused-privileges-logic.test.ts.
 * The non-vacuity test fails if the snapshot is empty or stops showing grants the app depends on, so the "none found" assertions can never pass on an empty read.
 */
import { describe, expect, it } from "vitest";
import { admin } from "../support/auth";
import { serviceOnlyFunctionFindings, unusedPrivilegeFindings } from "../support/unused-privileges";

async function snapshot() {
  const { data, error } = await admin.rpc("table_privilege_snapshot");
  if (error) throw error;
  return data ?? [];
}

describe("anon and authenticated hold none of TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on public tables", () => {
  it("the snapshot is not empty and still shows grants that must stay (non-vacuity)", async () => {
    const rows = await snapshot();
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.some((r) => ((r.source === "table" && r.object_name === "blog_posts") || (r.source === "column" && r.object_name.startsWith("blog_posts."))) && r.grantee === "anon" && r.privilege_type === "SELECT")).toBe(true);
    expect(rows.some((r) => r.source === "table" && r.object_name === "applications" && r.grantee === "authenticated" && r.privilege_type === "INSERT")).toBe(true);
    expect(rows.some((r) => r.source === "default" && r.object_name === "role postgres, schema public" && r.privilege_type === "SELECT" && r.grantee === "authenticated")).toBe(true);
    expect(rows.some((r) => r.source === "function" && r.grantee === "authenticated" && r.privilege_type === "EXECUTE" && r.object_name.startsWith("touch_last_active"))).toBe(true);
  });

  it("no public table, no column and no postgres default for schema public grants any of the four to anon, authenticated or PUBLIC", async () => {
    expect(await snapshot().then(unusedPrivilegeFindings), "revoke these in the migration that created or changed the table (or fix the default privileges)").toEqual([]);
  });

  it("count_rewarded_referrals_last_30d and check_and_activate_referral are not executable by anon, authenticated or PUBLIC", async () => {
    expect(await snapshot().then(serviceOnlyFunctionFindings)).toEqual([]);
  });
});
