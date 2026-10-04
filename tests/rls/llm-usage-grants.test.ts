/**
 * The daily LLM usage counter (migration 0223): who can touch it. DATABASE-BACKED, CI ONLY; written before the migration and red without it.
 *
 * The catalog is read only through the service-role-only snapshot functions (data_api_grants_snapshot, function_acl_audit): CI has no direct
 * database connection, and PostgREST does not expose information_schema. RLS-enabled and "no policies" are pinned in
 * tests/supabase/migration-0223-shape.test.ts (from the file) and checked again by the migration's own DO block when it is applied; nothing
 * callable from a test reads pg_class.relrowsecurity.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { admin as typedAdmin } from "../support/auth";

// Untyped for the same reason as tests/farah/llm-usage-counter.test.ts: the generated types do not know the new table or function yet.
const admin = typedAdmin as unknown as SupabaseClient;

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

describe("llm_daily_usage: no client role holds any privilege on it", () => {
  it("anon and authenticated have no grant of ANY kind (select, insert, update, delete, truncate, references, trigger)", async () => {
    const { data, error } = await admin.rpc("data_api_grants_snapshot");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0); // the snapshot is alive, so an empty answer below is a real answer
    expect((data ?? []).filter((g: { table_name: string }) => g.table_name === "llm_daily_usage")).toEqual([]);
  });

  it("an anonymous client is refused when it reads or writes the table", async () => {
    expect((await anon.from("llm_daily_usage").select("*")).error?.code).toBe("42501");
    expect((await anon.from("llm_daily_usage").insert({ day: "2026-01-01", bucket: "farah_chat", nano_usd: 1 })).error?.code).toBe("42501");
  });

  it("the service role can read, insert and update it (its privileges are written out in 0223, not inherited from default privileges)", async () => {
    expect((await admin.from("llm_daily_usage").select("*").limit(1)).error).toBeNull();
    const row = { day: "2001-01-01", bucket: "farah_chat", nano_usd: 1 };
    expect((await admin.from("llm_daily_usage").upsert(row, { onConflict: "day,bucket" })).error).toBeNull();
    expect((await admin.from("llm_daily_usage").update({ nano_usd: 2 }).eq("day", "2001-01-01").eq("bucket", "farah_chat")).error).toBeNull();
    expect((await admin.from("llm_daily_usage").update({ nano_usd: 0 }).eq("day", "2001-01-01").eq("bucket", "farah_chat")).error).toBeNull();
  });

  it("but NOT delete: nothing in the app needs it, so 0223 does not grant it (SQLSTATE 42501)", async () => {
    const r = await admin.from("llm_daily_usage").delete().eq("day", "2001-01-01");
    expect(r.error?.code).toBe("42501");
  });
});

describe("add_llm_usage: service role only, SECURITY INVOKER, search_path pinned", () => {
  it("function_acl_audit shows exactly one row for it, with the expected definer flag, search_path and grants", async () => {
    const { data, error } = await admin.rpc("function_acl_audit");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(50); // the audit is alive
    const rows = (data ?? []).filter((r: { function_name: string }) => r.function_name === "add_llm_usage");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      identity_args: "p_bucket text, p_nano bigint",
      security_definer: false,
      search_path_config: 'search_path=""',
      anon_exec: false,
      authenticated_exec: false,
      public_exec: false,
      service_role_exec: true,
    });
  });

  it("an anonymous client cannot call it", async () => {
    const r = await anon.rpc("add_llm_usage", { p_bucket: "farah_chat", p_nano: 1 });
    expect(r.error).not.toBeNull();
  });

  it("the service role can", async () => {
    const r = await admin.rpc("add_llm_usage", { p_bucket: "farah_chat", p_nano: 0 });
    expect(r.error).toBeNull();
  });
});
