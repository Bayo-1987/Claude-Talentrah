/**
 * send-513 — mentor_unpaid_hold() has a pinned search_path.
 *
 * Reads the function's own config from pg_proc (through the service-role-only `function_search_path_audit()` that 0210 adds, because supabase-js cannot
 * query the catalog) and fails unless search_path is the empty string. On main before 0210 the production catalog shows config `<none>` for this
 * function, which is also what Supabase's security advisor reports ("Function Search Path Mutable", one finding, this function). Runs against
 * CI's fresh per-job Supabase stack, which applies every migration from scratch, so 0210 is there by construction.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`unpaid-hold search_path test cannot run: ${key} is not set.`);
}
const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

describe("mentor_unpaid_hold()", () => {
  it("has search_path pinned to the empty string", async () => {
    const { data, error } = await admin.rpc("function_search_path_audit");
    expect(error).toBeNull();
    const fn = (data ?? []).find((r) => r.function_name === "mentor_unpaid_hold");
    expect(fn, "mentor_unpaid_hold exists in public").toBeTruthy();
    expect(fn!.search_path_config).toBe('search_path=""');
  });

  it("is still an ordinary (not SECURITY DEFINER) function: the pin changed its config and nothing else", async () => {
    const { data, error } = await admin.rpc("function_search_path_audit");
    expect(error).toBeNull();
    // The 30 minutes themselves are pinned by tests/mentorship/unpaid-hold.test.ts (it mirrors UNPAID_HOLD_MINUTES) and by the migration's own self-check.
    const fn = (data ?? []).find((r) => r.function_name === "mentor_unpaid_hold");
    expect(fn!.security_definer).toBe(false);
  });

  it("the audit read itself has its search_path pinned", async () => {
    const { data } = await admin.rpc("function_search_path_audit");
    const audit = (data ?? []).find((r) => r.function_name === "function_search_path_audit");
    expect(audit!.search_path_config).toBe('search_path=""');
  });

  it("the catalog read is service-role only (anon cannot call it)", async () => {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { error } = await anon.rpc("function_search_path_audit" as never);
    expect(error).not.toBeNull();
  });
});
