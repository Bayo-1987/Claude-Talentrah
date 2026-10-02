/**
 * Refer & Earn / 0215 — the three SECURITY DEFINER functions 0215 redefines keep what 0211 gave them.
 *
 * `CREATE OR REPLACE` keeps grants but replaces SET options and the security mode with the new text (see tests/supabase/migration-0215-shape.test.ts
 * for the text-level check). This reads the LIVE config from pg_proc through the service-role-only function_search_path_audit() (0210; supabase-js
 * cannot query the catalog) and fails unless each is still SECURITY DEFINER with search_path pinned, and proves behaviourally that the money function
 * gained no caller: grant_referral_reward cannot be called by anon or by a signed-in user. (The ACL of the other two before/after is compared inside
 * 0215 itself: its self-check aborts the migration if any EXECUTE grant or the search_path pin moved.)
 *
 * Runs against CI's fresh per-job Supabase stack, which applies every migration from scratch.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { randomUUID } from "node:crypto";
import { createAuthedTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`referral-functions-hardening test cannot run: ${key} is not set.`);
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient<Database>(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

const REPLACED = ["handle_new_user", "check_and_activate_referral", "grant_referral_reward"] as const;

describe("the functions 0215 replaces", () => {
  for (const name of REPLACED) {
    it(`${name} is still SECURITY DEFINER with search_path pinned to public`, async () => {
      const { data, error } = await admin.rpc("function_search_path_audit");
      expect(error).toBeNull();
      const rows = (data ?? []).filter((r) => r.function_name === name);
      expect(rows.length, `${name} exists in public`).toBeGreaterThan(0);
      for (const fn of rows) {
        expect(fn.security_definer, `${name} lost SECURITY DEFINER`).toBe(true);
        expect(fn.search_path_config, `${name} lost its search_path pin`).toBe("search_path=public");
      }
    });
  }

  it("grant_referral_reward (the money function) cannot be called by anon", async () => {
    const anon = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { error } = await anon.rpc("grant_referral_reward" as never, {
      p_referral_id: randomUUID(),
      p_referrer_id: randomUUID(),
      p_amount: 50,
      p_reason: "referral_activation_bonus",
    } as never);
    expect(error, "anon must not be able to call grant_referral_reward").not.toBeNull();
  });

  it("grant_referral_reward cannot be called by a signed-in user either", async () => {
    const user = await createAuthedTestUser("ref-harden");
    try {
      const { error } = await user.client.rpc("grant_referral_reward" as never, {
        p_referral_id: randomUUID(),
        p_referrer_id: user.id,
        p_amount: 50,
        p_reason: "referral_activation_bonus",
      } as never);
      expect(error, "a signed-in user must not be able to pay themselves").not.toBeNull();
    } finally {
      await deleteTestUsers([user.id]);
    }
  });
});
