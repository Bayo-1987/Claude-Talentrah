/**
 * Per-IP signup throttle (src/lib/auth/signup-rate-limit.ts) — send-405.
 * Signup had zero abuse protection before this (no rate limit, no CAPTCHA,
 * no honeypot — founder decision: rate limiting + honeypot only).
 *
 * The underlying counter (`consume_anonymous_rate_limit`, 0117) already has
 * its own exhaustive atomicity/isolation/fail-closed suite in
 * tests/auth/resend-rate-limit.test.ts, and the shared loopback-caller
 * handling is already proven in tests/security/login-rate-limit.test.ts —
 * this file is scoped to what's new here: this module's own configured
 * limit actually being enforced, and that it shares the reused
 * `isUnidentifiableCaller` behavior rather than reinventing it differently.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { consumeSignupRateLimit } from "@/lib/auth/signup-rate-limit";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Signup rate-limit test cannot run: ${key} is not set.`);
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

describe("consumeSignupRateLimit enforces its configured limit", () => {
  it("allows exactly the configured limit (5/hour), denies the rest", async () => {
    const ip = testIp();
    testKeys.push(ip);

    const results = await Promise.all(Array.from({ length: 8 }, () => consumeSignupRateLimit(ip)));
    expect(results.filter((r) => r.allowed).length).toBe(5);
    expect(results.filter((r) => !r.allowed).length).toBe(3);
  });

  it("one caller's IP cannot exhaust a different caller's budget", async () => {
    const noisyIp = testIp();
    const otherIp = testIp();
    testKeys.push(noisyIp, otherIp);

    await Promise.all(Array.from({ length: 10 }, () => consumeSignupRateLimit(noisyIp)));
    const other = await consumeSignupRateLimit(otherIp);
    expect(other.allowed, "a noisy IP locked out an unrelated caller").toBe(true);
  });

  it("a missing IP is allowed — this layer skips rather than blocking every real signup", async () => {
    const result = await consumeSignupRateLimit(null);
    expect(result.allowed).toBe(true);
  });

  it("a loopback IP (::1) is allowed — CI and local dev share exactly this address with no reverse proxy", async () => {
    const result = await consumeSignupRateLimit("::1");
    expect(result.allowed).toBe(true);
  });

  it("a broken RPC still denies a REAL identifiable caller rather than passing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/service-role", () => ({
      createServiceRoleClient: () => ({
        rpc: async () => ({ data: null, error: new Error("simulated outage") }),
      }),
    }));
    const { consumeSignupRateLimit: consumeWithBrokenRpc } = await import(
      "@/lib/auth/signup-rate-limit"
    );

    const outcome = await consumeWithBrokenRpc("198.51.100.9");
    expect(outcome.allowed, "an unreadable counter was treated as permission").toBe(false);

    vi.doUnmock("@/lib/supabase/service-role");
    vi.resetModules();
  });
});
