/**
 * P1 / 0204 — the attempt table, against the real database: the route's own writer lands a row, the 7-day view
 * counts it, and NO client (anon or signed-in) can read or write either. Same shape as the client-reach probe in
 * tests/auth/resend-rate-limit.test.ts: this is server bookkeeping about people who are not signed in.
 *
 * Rows are identified by a unique `reason` marker, so the cleanup deletes exactly this run's rows and the suite
 * stays safe next to anything else writing to the table (nothing here resets or truncates it).
 */
import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { recordDemoAttempt } from "@/lib/demo/attempt-log";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`attempt-table test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const MARK = `test-${randomUUID()}`;

afterAll(async () => {
  const { error } = await admin.from("anonymous_demo_attempts").delete().eq("reason", MARK);
  if (error) throw new Error(`cleanup failed, rows left behind (reason=${MARK}): ${error.message}`);
});

function asAnon() {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error("Need the publishable/anon key to test client reach.");
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe("anonymous_demo_attempts (0204)", () => {
  it("the route's writer lands a row with exactly the recorded fields", async () => {
    await recordDemoAttempt({ outcome: "refused", reason: MARK, errorClass: null, ipRuleActive: false });
    const { data, error } = await admin
      .from("anonymous_demo_attempts")
      .select("outcome, reason, error_class, ip_rule_active, created_at")
      .eq("reason", MARK);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ outcome: "refused", reason: MARK, error_class: null, ip_rule_active: false });
  });

  it("rejects an outcome outside the enumerated set", async () => {
    const { error } = await admin.from("anonymous_demo_attempts").insert({ outcome: "whatever", reason: MARK });
    expect(error?.code, "the check constraint should refuse an unknown outcome").toBe("23514");
  });

  it("the 7-day view counts the row, by outcome and reason", async () => {
    const { data, error } = await admin
      .from("anonymous_demo_outcomes_7d")
      .select("outcome, reason, attempts")
      .eq("reason", MARK);
    expect(error).toBeNull();
    expect(data).toEqual([{ outcome: "refused", reason: MARK, attempts: 1 }]);
  });

  it("an anonymous client can neither read nor write the table, nor read the view", async () => {
    const client = asAnon();
    const read = await client.from("anonymous_demo_attempts").select("*").eq("reason", MARK);
    expect(read.data ?? [], "an anonymous client could read attempt rows").toHaveLength(0);

    const write = await client.from("anonymous_demo_attempts").insert({ outcome: "success", reason: MARK });
    expect(write.error, "an anonymous client could insert an attempt row").toBeTruthy();

    const view = await client.from("anonymous_demo_outcomes_7d").select("*");
    expect(view.data ?? [], "an anonymous client could read the outcome view").toHaveLength(0);

    // and nothing leaked in through the failed insert
    const { data } = await admin.from("anonymous_demo_attempts").select("id").eq("reason", MARK);
    expect(data).toHaveLength(1);
  });
});
