/**
 * Per-IP contact-form throttle (src/lib/contact/rate-limit.ts) — send-405.
 * Same family as tests/auth/signup-rate-limit.test.ts and
 * tests/security/login-rate-limit.test.ts — the underlying counter
 * (`consume_anonymous_rate_limit`, 0117) already has its own atomicity suite
 * in tests/auth/resend-rate-limit.test.ts, so this is scoped to this
 * module's own configured limit and its reuse of the shared
 * `isUnidentifiableCaller` loopback handling.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { consumeContactRateLimit } from "@/lib/contact/rate-limit";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Contact rate-limit test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function testIp(): string {
  return `203.0.113.${Math.floor(Math.random() * 254) + 1}.${randomUUID().slice(0, 8)}`;
}

const testKeys: string[] = [];
afterAll(async () => {
  if (testKeys.length) {
    const { error } = await admin.from("anonymous_rate_limits").delete().in("rate_key", testKeys);
    if (error) console.warn(`[cleanup] could not delete fixture rate-limit rows: ${error.message}`);
  }
});

describe("consumeContactRateLimit enforces its configured limit", () => {
  it("allows exactly the configured limit (3/hour), denies the rest", async () => {
    const ip = testIp();
    testKeys.push(ip);

    const results = await Promise.all(Array.from({ length: 6 }, () => consumeContactRateLimit(ip)));
    expect(results.filter((r) => r.allowed).length).toBe(3);
    expect(results.filter((r) => !r.allowed).length).toBe(3);
  });

  it("a missing IP is allowed — this layer skips rather than blocking every real submission", async () => {
    const result = await consumeContactRateLimit(null);
    expect(result.allowed).toBe(true);
  });

  it("a loopback IP (::1) is allowed — CI and local dev share exactly this address with no reverse proxy", async () => {
    const result = await consumeContactRateLimit("::1");
    expect(result.allowed).toBe(true);
  });

  it("a broken RPC still denies a REAL identifiable caller rather than passing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/service-role", () => ({
      createServiceRoleClient: () => ({
        rpc: async () => ({ data: null, error: new Error("simulated outage") }),
      }),
    }));
    const { consumeContactRateLimit: consumeWithBrokenRpc } = await import(
      "@/lib/contact/rate-limit"
    );

    const outcome = await consumeWithBrokenRpc("198.51.100.11");
    expect(outcome.allowed, "an unreadable counter was treated as permission").toBe(false);

    vi.doUnmock("@/lib/supabase/service-role");
    vi.resetModules();
  });
});
