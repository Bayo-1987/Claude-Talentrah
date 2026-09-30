/**
 * Per-IP login brute-force throttle (src/lib/security/login-rate-limit.ts) —
 * the fix for the gap `docs/admin-auth.md` and `src/lib/admin/actions.ts`
 * already self-diagnosed: Supabase rate-limits `signInWithPassword` per
 * source IP, but both login Server Actions call it from THIS server, so the
 * limit was one shared ceiling across every real user, not a throttle on any
 * one attacker.
 *
 * The underlying counter (`consume_anonymous_rate_limit`, 0117) already has
 * its own exhaustive atomicity/isolation/fail-closed suite in
 * tests/auth/resend-rate-limit.test.ts — this file is deliberately scoped to
 * what's NEW here: this module's own bucket names/limits actually being
 * enforced, admin vs. seeker staying independent, and the null-IP fail-
 * closed behavior — not re-proving Postgres row locking a second time.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { consumeLoginRateLimit } from "@/lib/security/login-rate-limit";
import { inOneWindow } from "../support/single-window";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Login rate-limit test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function testIp(): string {
  // Distinct per call, real-looking, never collides with a genuine caller.
  return `203.0.113.${Math.floor(Math.random() * 254) + 1}.${randomUUID().slice(0, 8)}`;
}

const testKeys: string[] = [];
afterAll(async () => {
  if (testKeys.length) {
    const { error } = await admin.from("anonymous_rate_limits").delete().in("rate_key", testKeys);
    if (error) console.warn(`[cleanup] could not delete fixture rate-limit rows: ${error.message}`);
  }
});

describe("consumeLoginRateLimit enforces its own configured limits", () => {
  it("seeker login: allows exactly the configured limit, denies the rest", async () => {
    // 20/15min per LOGIN_RATE_LIMITS.seekerLogin — driven at +3 over so both
    // the allowed and the denied side are actually exercised.
    //
    // `inOneWindow`: the counter uses FIXED clock-aligned windows, so a burst
    // that straddles a boundary (:00/:15/:30/:45) is counted in two and admits
    // more than 20 — this test failed once in CI exactly that way (send-482;
    // see login-rate-limit-window.test.ts). Such a run is repeated on a fresh
    // key rather than asserted on.
    const { results } = await inOneWindow(async () => {
      const ip = testIp();
      testKeys.push(ip);
      const results = await Promise.all(
        Array.from({ length: 23 }, () => consumeLoginRateLimit(ip, "seekerLogin")),
      );
      return { results, outcomes: results };
    });
    expect(results.filter((r) => r.allowed).length).toBe(20);
    expect(results.filter((r) => !r.allowed).length).toBe(3);
  });

  it("admin login: allows exactly its OWN (tighter) configured limit", async () => {
    const { results } = await inOneWindow(async () => {
      const ip = testIp();
      testKeys.push(ip);
      const results = await Promise.all(
        Array.from({ length: 11 }, () => consumeLoginRateLimit(ip, "adminLogin")),
      );
      return { results, outcomes: results };
    });
    expect(results.filter((r) => r.allowed).length).toBe(8);
    expect(results.filter((r) => !r.allowed).length).toBe(3);
  });

  it("the same IP gets independent budgets for seeker vs admin login — exhausting one does not close the other", async () => {
    // One window for the whole scenario: the 9th admin call is only "denied" if
    // it is counted in the SAME window as the 8 before it (send-482).
    const { adminNowDenied, seekerStillAllowed } = await inOneWindow(async () => {
      const ip = testIp();
      testKeys.push(ip);

      // Exhaust the (tighter) admin bucket for this IP.
      const exhaust = await Promise.all(
        Array.from({ length: 8 }, () => consumeLoginRateLimit(ip, "adminLogin")),
      );
      const adminNowDenied = await consumeLoginRateLimit(ip, "adminLogin");
      // The seeker bucket, same IP, is untouched. (A different bucket has its own
      // window end, so it is not part of the one-window check on the admin calls.)
      const seekerStillAllowed = await consumeLoginRateLimit(ip, "seekerLogin");
      return { adminNowDenied, seekerStillAllowed, outcomes: [...exhaust, adminNowDenied] };
    });
    expect(adminNowDenied.allowed).toBe(false);
    expect(seekerStillAllowed.allowed).toBe(true);
  });

  it("one attacker's IP cannot exhaust a different caller's budget", async () => {
    const attackerIp = testIp();
    const victimIp = testIp();
    testKeys.push(attackerIp, victimIp);

    await Promise.all(
      Array.from({ length: 25 }, () => consumeLoginRateLimit(attackerIp, "seekerLogin")),
    );
    const victim = await consumeLoginRateLimit(victimIp, "seekerLogin");
    expect(victim.allowed, "a noisy attacker IP locked out an unrelated caller").toBe(true);
  });
});

describe("an unidentifiable caller is skipped, not denied outright", () => {
  /*
   * THE LIVE BUG THIS SECTION WAS REWRITTEN AGAINST — see
   * login-rate-limit.ts's own header on `isUnidentifiableCaller` for the
   * full account. The original version of this describe block was called
   * "fails CLOSED, not open" and asserted the opposite of what's below; it
   * passed here and then broke roughly 30 unrelated e2e specs in the first
   * real CI run, because every one of them shares one loopback IP with no
   * distinguishing proxy in front — exactly the case this now covers.
   */
  it("a missing IP is allowed — this layer skips rather than blocking every real login", async () => {
    const result = await consumeLoginRateLimit(null, "seekerLogin");
    expect(result.allowed).toBe(true);
  });

  it("a loopback IP (::1) is allowed — CI and local dev share exactly this address with no reverse proxy", async () => {
    const result = await consumeLoginRateLimit("::1", "seekerLogin");
    expect(result.allowed).toBe(true);
  });

  it("a loopback IP (127.0.0.1) is allowed", async () => {
    const result = await consumeLoginRateLimit("127.0.0.1", "adminLogin");
    expect(result.allowed).toBe(true);
  });

  it("skipping for loopback never touches the real counter — a genuine attacker IP is still tracked independently", async () => {
    // Loopback calls interleaved with real ones must not share a bucket or
    // otherwise perturb the real IP's own count.
    const { results } = await inOneWindow(async () => {
      const attackerIp = testIp();
      testKeys.push(attackerIp);

      await consumeLoginRateLimit("::1", "seekerLogin");
      const results = await Promise.all(
        Array.from({ length: 22 }, () => consumeLoginRateLimit(attackerIp, "seekerLogin")),
      );
      await consumeLoginRateLimit(null, "seekerLogin");
      return { results, outcomes: results };
    });

    expect(results.filter((r) => r.allowed).length).toBe(20);
    expect(results.filter((r) => !r.allowed).length).toBe(2);
  });

  it("a broken RPC still denies a REAL identifiable caller rather than passing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/service-role", () => ({
      createServiceRoleClient: () => ({
        rpc: async () => ({ data: null, error: new Error("simulated outage") }),
      }),
    }));
    const { consumeLoginRateLimit: consumeWithBrokenRpc } = await import(
      "@/lib/security/login-rate-limit"
    );

    const outcome = await consumeWithBrokenRpc("198.51.100.7", "seekerLogin");
    expect(outcome.allowed, "an unreadable counter was treated as permission").toBe(false);

    vi.doUnmock("@/lib/supabase/service-role");
    vi.resetModules();
  });
});
