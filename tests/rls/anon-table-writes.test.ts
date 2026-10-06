/**
 * Standing test for migration 0229_anon_table_writes; it needs 0227's public.table_privilege_snapshot().
 *
 * Nothing signed-out writes through the anon role (every signed-out write the app makes uses the service role), so anon must hold none of INSERT, UPDATE or DELETE on any public table, at table or column level, and a table the postgres role creates later
 * must not get them from the default privileges. A grant to PUBLIC would reach anon too, so it fails this as well. supabase_admin's defaults are out of scope (see 0227's note). The rule is tested without a database, with planted grants, in
 * tests/rls/unused-privileges-logic.test.ts. The non-vacuity test fails if the snapshot is empty or stops showing grants that must stay. Runs in CI against the database every migration has been applied to.
 */
import { describe, expect, it } from "vitest";
import { admin } from "../support/auth";
import { anonWriteFindings } from "../support/unused-privileges";

async function snapshot() {
  const { data, error } = await admin.rpc("table_privilege_snapshot");
  if (error) throw error;
  return data ?? [];
}

describe("anon holds no INSERT, UPDATE or DELETE on any public table", () => {
  it("the snapshot is not empty and still shows grants that must stay (non-vacuity)", async () => {
    const rows = await snapshot();
    expect(rows.some((r) => ((r.source === "table" && r.object_name === "blog_posts") || (r.source === "column" && r.object_name.startsWith("blog_posts."))) && r.grantee === "anon" && r.privilege_type === "SELECT")).toBe(true);
    expect(rows.some((r) => r.source === "table" && r.object_name === "applications" && r.grantee === "authenticated" && r.privilege_type === "INSERT")).toBe(true);
    expect(rows.some((r) => r.source === "default" && r.object_name === "role postgres, schema public" && r.grantee === "anon" && r.privilege_type === "SELECT")).toBe(true);
  });

  it("no public table, no column and no postgres default for schema public grants anon (or PUBLIC) INSERT, UPDATE or DELETE", async () => {
    expect(await snapshot().then(anonWriteFindings), "revoke these from anon in the migration that created or changed the table (or fix the default privileges)").toEqual([]);
  });
});
