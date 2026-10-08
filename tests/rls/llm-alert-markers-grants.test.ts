/**
 * The operator-alert attempts (migration 0235): who can touch them. DATABASE-BACKED, CI ONLY; written before the migration and red without it. Same method as tests/rls/llm-usage-grants.test.ts:
 * the catalog is read only through the service-role-only snapshot functions (data_api_grants_snapshot, function_acl_audit).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { admin as typedAdmin } from "../support/auth";

const admin = typedAdmin as unknown as SupabaseClient;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const TABLE = "llm_daily_usage_alert_markers";

describe("llm_daily_usage_alert_markers: no client role holds any privilege on it", () => {
  it("anon and authenticated have no grant of ANY kind", async () => {
    const { data, error } = await admin.rpc("data_api_grants_snapshot");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0); // the snapshot is alive, so an empty answer below is a real answer
    expect((data ?? []).filter((g: { table_name: string }) => g.table_name === TABLE)).toEqual([]);
  });

  it("an anonymous client is refused when it reads or writes the table (SQLSTATE 42501)", async () => {
    expect((await anon.from(TABLE).select("*")).error?.code).toBe("42501");
    expect((await anon.from(TABLE).insert({ day: "2026-01-01", alert: "eighty", attempts: 0 })).error?.code).toBe("42501");
    expect((await anon.from(TABLE).update({ attempts: 0 }).eq("alert", "eighty")).error?.code).toBe("42501");
  });

  it("the service role can read, insert and update it, but NOT delete (nothing in the app needs it)", async () => {
    expect((await admin.from(TABLE).select("*").limit(1)).error).toBeNull();
    const row = { day: "2001-01-01", alert: "eighty", attempts: 0 };
    expect((await admin.from(TABLE).upsert(row, { onConflict: "day,alert" })).error).toBeNull();
    expect((await admin.from(TABLE).update({ attempts: 1 }).eq("day", "2001-01-01").eq("alert", "eighty")).error).toBeNull();
    expect((await admin.from(TABLE).delete().eq("day", "2001-01-01")).error?.code).toBe("42501");
  });
});

describe("claim_llm_alert_attempt and mark_llm_alert_sent: service role only, SECURITY INVOKER, search_path pinned", () => {
  const expected = [
    { name: "claim_llm_alert_attempt", args: "p_alert text, p_max_attempts integer, p_lease_seconds integer" },
    { name: "mark_llm_alert_sent", args: "p_alert text" },
  ];

  for (const fn of expected) {
    it(`${fn.name}: function_acl_audit shows exactly one row, with the expected definer flag, search_path and grants`, async () => {
      const { data, error } = await admin.rpc("function_acl_audit");
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(50); // the audit is alive
      const rows = (data ?? []).filter((r: { function_name: string }) => r.function_name === fn.name);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        identity_args: fn.args,
        security_definer: false,
        search_path_config: 'search_path=""',
        anon_exec: false,
        authenticated_exec: false,
        public_exec: false,
        service_role_exec: true,
      });
    });

    it(`${fn.name}: an anonymous client cannot call it`, async () => {
      const args = fn.name === "mark_llm_alert_sent" ? { p_alert: "eighty" } : { p_alert: "eighty", p_max_attempts: 3, p_lease_seconds: 10 };
      const r = await anon.rpc(fn.name, args);
      expect(r.error).not.toBeNull();
      expect(r.error?.code).toBe("42501");
    });
  }
});
