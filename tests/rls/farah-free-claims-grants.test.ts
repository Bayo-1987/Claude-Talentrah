/**
 * The free-message claim (migration 0236): who can touch it. DATABASE-BACKED, CI ONLY; written before the migration and red without it. Same method as tests/rls/llm-usage-grants.test.ts: the catalog is
 * read only through the service-role-only snapshot functions (data_api_grants_snapshot, function_acl_audit), and a signed-in user is tried for real.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { admin as typedAdmin, createAuthedTestUser, deleteTestUsers } from "../support/auth";

const admin = typedAdmin as unknown as SupabaseClient;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const TABLE = "farah_free_claims";
const created: string[] = [];
afterAll(async () => {
  if (created.length) await deleteTestUsers(created);
}, 60_000);

const FUNCTIONS = [
  { name: "claim_farah_free_message", args: "p_user_id uuid, p_allowance integer, p_window_days integer, p_hold_seconds integer", call: (id: string) => ({ p_user_id: id, p_allowance: 3, p_window_days: 30, p_hold_seconds: 120 }) },
  { name: "commit_farah_free_claim", args: "p_claim_id uuid, p_user_id uuid, p_credits_available integer", call: (id: string) => ({ p_claim_id: id, p_user_id: id, p_credits_available: 0 }) },
  { name: "release_farah_free_claim", args: "p_claim_id uuid, p_user_id uuid", call: (id: string) => ({ p_claim_id: id, p_user_id: id }) },
];

describe("farah_free_claims: no client role holds any privilege on it", () => {
  it("anon and authenticated have no grant of ANY kind", async () => {
    const { data, error } = await admin.rpc("data_api_grants_snapshot");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0); // the snapshot is alive, so an empty answer below is a real answer
    expect((data ?? []).filter((g: { table_name: string }) => g.table_name === TABLE)).toEqual([]);
  });

  it("an anonymous client is refused when it reads or writes the table (SQLSTATE 42501)", async () => {
    expect((await anon.from(TABLE).select("*")).error?.code).toBe("42501");
    expect((await anon.from(TABLE).insert({ user_id: "00000000-0000-0000-0000-000000000000", expires_at: new Date().toISOString() })).error?.code).toBe("42501");
    expect((await anon.from(TABLE).delete().eq("id", "00000000-0000-0000-0000-000000000000")).error?.code).toBe("42501");
  });

  it("a signed-in user is refused too: it cannot read its own or anyone's claims, write one, or delete one", async () => {
    const user = await createAuthedTestUser("fclaimgrant");
    created.push(user.id);
    const db = user.client as unknown as SupabaseClient;
    expect((await db.from(TABLE).select("*")).error?.code).toBe("42501");
    expect((await db.from(TABLE).insert({ user_id: user.id, expires_at: new Date(Date.now() + 60_000).toISOString() })).error?.code).toBe("42501");
    expect((await db.from(TABLE).delete().eq("user_id", user.id)).error?.code).toBe("42501");
  });

  it("the service role can read, insert and delete, but NOT update (nothing in the app needs it)", async () => {
    const user = await createAuthedTestUser("fclaimgrant2");
    created.push(user.id);
    const inserted = await admin.from(TABLE).insert({ user_id: user.id, expires_at: new Date(Date.now() + 60_000).toISOString() }).select("id").single();
    expect(inserted.error).toBeNull();
    const id = (inserted.data as { id: string }).id;
    expect((await admin.from(TABLE).select("id").eq("id", id)).error).toBeNull();
    expect((await admin.from(TABLE).update({ expires_at: new Date().toISOString() }).eq("id", id)).error?.code).toBe("42501");
    expect((await admin.from(TABLE).delete().eq("id", id)).error).toBeNull();
  });
});

describe("the three functions: service role only, SECURITY INVOKER, search_path pinned", () => {
  for (const fn of FUNCTIONS) {
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

    it(`${fn.name}: an anonymous client and a signed-in user are both refused (42501)`, async () => {
      const user = await createAuthedTestUser("fclaimgrant3");
      created.push(user.id);
      const args = fn.call(user.id);
      expect((await anon.rpc(fn.name, args)).error?.code).toBe("42501");
      expect(((await (user.client as unknown as SupabaseClient).rpc(fn.name, args)).error ?? {}).code).toBe("42501");
    });
  }
});
