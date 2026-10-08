/**
 * STANDING DATABASE TEST for migrations 0227 (remainder) and 0229: the two client roles keep no write or maintenance privilege they never use. DATABASE-BACKED, CI ONLY (it needs the service-role-only
 * public.table_privilege_snapshot() that 0227 creates, and runs against the database every migration has been applied to).
 *
 * It fails if ANY of these appears on a public table, so a new table or a careless GRANT cannot bring one back:
 *   - anon holds INSERT, UPDATE or DELETE on the table (directly, through PUBLIC, or by a PUBLIC grant),
 *   - anon (or PUBLIC) holds a column-level INSERT or UPDATE,
 *   - the postgres role's default privileges for schema public would hand anon INSERT, UPDATE or DELETE to a table created later,
 *   - anon, authenticated or PUBLIC holds MAINTAIN (VACUUM, ANALYZE, REINDEX, CLUSTER, LOCK TABLE; PostgreSQL 17 and later), at table or column level or in the same defaults.
 * supabase_admin's default privileges are deliberately NOT asserted: platform-created tables are not ours, and the migrating role may not change that role's defaults (0239's note).
 * TRUNCATE, REFERENCES and TRIGGER are held by tests/rls/client-ddl-privileges.test.ts (0239); the two referral functions by tests/rls/table-privileges.test.ts.
 *
 * Red-first: against a database before 0227 and 0229 the findings below are the 100 anon write pairs, the 24 job_postings column grants and the 102 MAINTAIN pairs the read-only audit of 8 Oct 2026 found on both projects;
 * the rule functions are proven against planted grants, one case per kind, in tests/rls/unused-privileges-logic.test.ts (mutation proof: remove a revoke from 0229 or 0227 and this file names the table).
 * The non-vacuity test fails if the snapshot is empty or stops showing grants that must stay, so "none found" can never pass on an empty read.
 */
import { describe, expect, it } from "vitest";
import { admin } from "../support/auth";
import { anonWriteFindings, maintainFindings } from "../support/unused-privileges";

async function snapshot() {
  const { data, error } = await admin.rpc("table_privilege_snapshot");
  if (error) throw error;
  return data ?? [];
}

describe("the client roles hold no write privilege for anon and no MAINTAIN for anyone, on any public table", () => {
  it("the snapshot is not empty and still shows grants that must stay (non-vacuity)", async () => {
    const rows = await snapshot();
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.some((r) => ((r.source === "table" && r.object_name === "blog_posts") || (r.source === "column" && r.object_name.startsWith("blog_posts."))) && r.grantee === "anon" && r.privilege_type === "SELECT")).toBe(true);
    expect(rows.some((r) => r.source === "table" && r.object_name === "applications" && r.grantee === "authenticated" && r.privilege_type === "INSERT")).toBe(true);
    expect(rows.some((r) => r.source === "default" && r.object_name === "role postgres, schema public" && r.grantee === "anon" && r.privilege_type === "SELECT")).toBe(true);
  });

  it("anon holds no INSERT, UPDATE or DELETE: not on a table, not on a column, and not in the postgres default privileges for schema public (PUBLIC grants count as anon)", async () => {
    expect(await snapshot().then(anonWriteFindings), "revoke these from anon in the migration that created or changed the table (or fix the default privileges)").toEqual([]);
  });

  it("neither anon nor authenticated (nor PUBLIC) holds MAINTAIN: not on a table, not on a column, and not in the postgres default privileges for schema public", async () => {
    expect(await snapshot().then(maintainFindings), "revoke MAINTAIN from anon and authenticated in the migration that created the table (or fix the default privileges)").toEqual([]);
  });
});
