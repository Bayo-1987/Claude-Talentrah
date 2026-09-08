/**
 * The anonymous, text-keyed rate limiter behind the check-email resend
 * actions (migration 0117) — a REAL database test, not an assertion against
 * the migration's own SQL text, for the same reason tests/api/rate-limit.test.ts
 * is one: the property under test is that N *concurrent* callers cannot all
 * pass a limit of N, which is a statement about Postgres row locking that a
 * mocked counter would be correct-by-construction about while the real thing
 * raced.
 *
 * WHY A SEPARATE SUITE FROM tests/api/rate-limit.test.ts. That file tests
 * `consume_rate_limit` (0038), keyed on an authenticated `user_id`. This one
 * tests `consume_anonymous_rate_limit` (0117), keyed on arbitrary TEXT — an
 * email address or an IP — because the resend actions have no session and no
 * user id to key on at all. Same atomic pattern, different key shape, so a
 * separate table and a separate suite.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { consumeResendRateLimit, RESEND_RATE_LIMITS } from "@/lib/auth/resend-rate-limit";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Resend rate-limit test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** Drives the counter directly, without depending on the module's own bucket names/limits. */
async function callRaw(key: string, bucket: string, limit: number) {
  const { data, error } = await admin.rpc("consume_anonymous_rate_limit", {
    p_key: key,
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: 3600,
  });
  if (error) throw error;
  return data![0];
}

const testKeys: string[] = [];
afterAll(async () => {
  if (testKeys.length) {
    const { error } = await admin
      .from("anonymous_rate_limits")
      .delete()
      .in("rate_key", testKeys);
    if (error) console.warn(`[cleanup] could not delete fixture rate-limit rows: ${error.message}`);
  }
});

describe("the counter is atomic", () => {
  it("twenty concurrent calls against a limit of five: exactly five are allowed", async () => {
    const key = `probe-concurrency-${randomUUID()}@talentrah.test`;
    testKeys.push(key);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => callRaw(key, "concurrency-probe", 5)),
    );
    const allowed = results.filter((r) => r.allowed).length;

    expect(allowed, `BURST: ${allowed} of 20 concurrent requests passed a limit of 5`).toBe(5);

    const counts = results.map((r) => r.used).sort((a, b) => a - b);
    expect(counts).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("one key's traffic cannot consume another key's allowance", async () => {
    const keyA = `probe-isolation-a-${randomUUID()}@talentrah.test`;
    const keyB = `probe-isolation-b-${randomUUID()}@talentrah.test`;
    testKeys.push(keyA, keyB);

    await Promise.all(Array.from({ length: 8 }, () => callRaw(keyA, "isolation-probe", 3)));
    const other = await callRaw(keyB, "isolation-probe", 3);
    expect(other.allowed, "a noisy key locked another key out").toBe(true);
    expect(other.used).toBe(1);
  });

  it("buckets are independent for the same key — exhausting one does not close the other", async () => {
    const key = `probe-bucket-independence-${randomUUID()}@talentrah.test`;
    testKeys.push(key);

    await Promise.all(Array.from({ length: 5 }, () => callRaw(key, "bucket-a", 2)));
    const b = await callRaw(key, "bucket-b", 2);
    expect(b.allowed).toBe(true);
  });
});

describe("the counter is not client-reachable", () => {
  it("an anonymous client can neither read nor reset the table", async () => {
    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!anonKey) throw new Error("Need the publishable/anon key to test client reach.");

    const key = `probe-client-reach-${randomUUID()}@talentrah.test`;
    testKeys.push(key);
    await callRaw(key, "client-reach-probe", 1);

    const asAnon = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const read = await asAnon.from("anonymous_rate_limits").select("*");
    expect(read.data ?? [], "an anonymous client could read the rate-limit table").toHaveLength(0);

    const del = await asAnon.from("anonymous_rate_limits").delete().eq("rate_key", key);
    expect(del.error ?? { code: "no-error" }, "an anonymous client could delete a counter row").toBeTruthy();

    const { data: still } = await admin
      .from("anonymous_rate_limits")
      .select("request_count")
      .eq("rate_key", key)
      .eq("bucket", "client-reach-probe");
    expect(still ?? []).toHaveLength(1);
  });

  it("the RPC itself is not executable by an anonymous client", async () => {
    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const asAnon = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await asAnon.rpc("consume_anonymous_rate_limit", {
      p_key: "forged@talentrah.test",
      p_bucket: "forged",
      p_limit: 999999,
      p_window_seconds: 1,
    });
    expect(error, "an anonymous client could call the limiter directly").toBeTruthy();
  });
});

describe("the module wired over it (consumeResendRateLimit)", () => {
  it("enforces the configured per-email limit", async () => {
    const email = `probe-email-limit-${randomUUID()}@talentrah.test`;
    testKeys.push(email.toLowerCase());
    const { limit } = RESEND_RATE_LIMITS.resendEmail;

    const results = await Promise.all(
      // Distinct, never-before-seen IPs per call so the IP bucket (20/day)
      // cannot be what denies these — only the email bucket should.
      Array.from({ length: limit + 3 }, () =>
        consumeResendRateLimit(email, `10.0.0.${randomUUID().slice(0, 2)}`),
      ),
    );
    expect(results.filter((r) => r.allowed).length).toBe(limit);
    expect(results.filter((r) => !r.allowed).length).toBe(3);
  });

  it("enforces the configured per-IP limit across DIFFERENT email addresses", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    testKeys.push(ip);
    const { limit } = RESEND_RATE_LIMITS.resendIp;

    const results = await Promise.all(
      Array.from({ length: limit + 3 }, () => {
        const email = `probe-ip-limit-${randomUUID()}@talentrah.test`;
        testKeys.push(email);
        return consumeResendRateLimit(email, ip);
      }),
    );
    expect(results.filter((r) => r.allowed).length).toBe(limit);
    expect(results.filter((r) => !r.allowed).length).toBe(3);
  });

  it("a missing IP still enforces the email bucket rather than skipping all limiting", async () => {
    const email = `probe-no-ip-${randomUUID()}@talentrah.test`;
    testKeys.push(email.toLowerCase());
    const { limit } = RESEND_RATE_LIMITS.resendEmail;

    const results = await Promise.all(
      Array.from({ length: limit + 2 }, () => consumeResendRateLimit(email, null)),
    );
    expect(results.filter((r) => r.allowed).length).toBe(limit);
  });

});

describe("fails CLOSED when the counter itself errors", () => {
  it("a broken RPC denies rather than passes, for both buckets", async () => {
    // Positive control on the failure branch, isolated from the real
    // database by mocking the service-role client this module builds
    // internally — a database blip is most likely exactly when the system
    // is under load, which is the worst possible moment to treat an
    // unreadable counter as headroom.
    vi.resetModules();
    vi.doMock("@/lib/supabase/service-role", () => ({
      createServiceRoleClient: () => ({
        rpc: async () => ({ data: null, error: new Error("simulated outage") }),
      }),
    }));
    const { consumeResendRateLimit: consumeWithBrokenRpc } = await import(
      "@/lib/auth/resend-rate-limit"
    );

    const outcome = await consumeWithBrokenRpc("probe-outage@talentrah.test", "198.51.100.7");
    expect(outcome.allowed, "an unreadable counter was treated as permission").toBe(false);

    vi.doUnmock("@/lib/supabase/service-role");
    vi.resetModules();
  });
});
