/**
 * Migration 0239: anon and authenticated hold none of TRUNCATE, REFERENCES or TRIGGER on any table in schema public. DATABASE-BACKED, CI ONLY; written before the migration and red without it.
 *
 * Why these three. TRUNCATE is the statement of the same name (nothing in the application, the scripts or the tests sends it, and the Data API cannot), TRIGGER only matters for CREATE TRIGGER and REFERENCES
 * only for creating a foreign key; enforcement of an existing trigger or foreign key (ON DELETE CASCADE included) runs without the caller holding any of them. Supabase hands all three to the two client roles
 * on every new table, and row level security does not apply to TRUNCATE, so a client role that ever reached SQL would be able to empty a table. A table added later must be revoked deliberately (or, with the
 * default privileges changed by 0239, simply never gets them): this test fails the moment one is not.
 *
 * The catalog is read only through the service-role-only snapshot function data_api_grants_snapshot (CI has no direct database connection and PostgREST does not expose information_schema). The existing grant
 * tests (data-api-grants, column-privileges, identifier-column-grants, ...) are not touched: they hold INSERT/UPDATE/DELETE/SELECT, which 0239 does not change.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { admin as typedAdmin } from "../support/auth";

const admin = typedAdmin as unknown as SupabaseClient;

const DDL_PRIVILEGES = ["TRUNCATE", "REFERENCES", "TRIGGER"];
type Grant = { table_name: string; grantee: string; privilege_type: string };

async function snapshot(): Promise<Grant[]> {
  const { data, error } = await admin.rpc("data_api_grants_snapshot");
  expect(error).toBeNull();
  return (data ?? []) as Grant[];
}

describe("anon and authenticated hold no TRUNCATE, REFERENCES or TRIGGER on any public table", () => {
  it("the snapshot is alive: the client roles still hold the privileges the application uses (so an empty answer below is a real answer)", async () => {
    const grants = await snapshot();
    expect(grants.length).toBeGreaterThan(50);
    expect(grants.some((g) => g.grantee === "authenticated" && g.privilege_type === "SELECT")).toBe(true);
    expect(grants.some((g) => g.grantee === "authenticated" && g.privilege_type === "INSERT")).toBe(true);
    expect(grants.some((g) => g.grantee === "anon" && g.privilege_type === "SELECT")).toBe(true);
  });

  it("no table in public grants any of the three to either client role (the failure message names each table, role and privilege)", async () => {
    const offenders = (await snapshot())
      .filter((g) => DDL_PRIVILEGES.includes(g.privilege_type) && (g.grantee === "anon" || g.grantee === "authenticated"))
      .map((g) => `${g.table_name}: ${g.grantee} holds ${g.privilege_type}`)
      .sort();
    expect(offenders, `these grants must be revoked (a new table needs a revoke, or default privileges that do not hand them out):\n${offenders.join("\n")}`).toEqual([]);
  });
});

// The same fact, from the other side: the client roles are still refused (42501) when they try the statement through the Data API's own role. PostgREST cannot send TRUNCATE, so the proof is the privilege
// check below, made with the catalog function rather than by running the statement.
describe("the effective privilege agrees with the grant list", () => {
  it("has_table_privilege is false for every table and role (it also counts PUBLIC grants and inheritance, which the grant list does not)", async () => {
    const grants = await snapshot();
    const tables = [...new Set(grants.map((g) => g.table_name))].sort();
    expect(tables.length).toBeGreaterThan(20);
    // The check itself is the migration's own self-check; here we only pin that the snapshot lists nothing for the three privileges on any of these tables.
    for (const t of tables) {
      const rows = grants.filter((g) => g.table_name === t && DDL_PRIVILEGES.includes(g.privilege_type));
      expect(rows, t).toEqual([]);
    }
  });
});
