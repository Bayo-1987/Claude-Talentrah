/**
 * signUpAction's own per-IP throttle (src/lib/auth/actions.ts) — send-405:
 * signup had zero abuse protection before this. Mirrors
 * signin-rate-limit-wiring.test.ts's own approach exactly: the underlying
 * `consume_anonymous_rate_limit` counter already has its own atomicity suite
 * (tests/auth/resend-rate-limit.test.ts) and this module's own bucket/limit
 * enforcement is proven directly (tests/auth/signup-rate-limit.test.ts) — this
 * file proves signUpAction actually calls it, and calls it BEFORE
 * supabase.auth.signUp(), against the REAL rate limiter (only the Supabase
 * auth call itself is mocked).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`signUpAction rate-limit test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Errors rather than succeeding, the same way the sign-in wiring test uses a
// wrong password — avoids signUpAction's own success path (redirect(),
// cookies(), captureEvent()), which is unrelated to what this file proves.
const signUpSpy = vi.hoisted(() =>
  vi.fn(async () => ({ data: { user: null, session: null }, error: { message: "simulated signup failure" } })),
);
const headerStore = vi.hoisted(() => ({ current: new Map<string, string>() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signUp: signUpSpy },
  }),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => headerStore.current.get(name) ?? null,
  }),
  cookies: async () => ({ getAll: () => [], set: () => {}, delete: () => {} }),
}));

const { signUpAction } = await import("@/lib/auth/actions");

function setIp(ip: string) {
  headerStore.current = new Map([["x-forwarded-for", ip]]);
}

function signupForm() {
  const fd = new FormData();
  fd.set("firstName", "Ada");
  fd.set("lastName", "Lovelace");
  fd.set("email", "prober@talentrah.test");
  fd.set("country", "Nigeria");
  fd.set("password", "Password123");
  fd.set("termsAccepted", "on");
  return fd;
}

const testKeys: string[] = [];

beforeEach(() => {
  signUpSpy.mockClear();
});

afterAll(async () => {
  if (testKeys.length) {
    const { error } = await admin.from("anonymous_rate_limits").delete().in("rate_key", testKeys);
    if (error) console.warn(`[cleanup] could not delete fixture rate-limit rows: ${error.message}`);
  }
});

describe("signUpAction's per-IP rate limit", () => {
  it("allows ordinary attempts through to the real supabase.auth.signUp call", async () => {
    const ip = `192.0.2.${Math.floor(Math.random() * 40) + 1}`;
    testKeys.push(ip);
    setIp(ip);

    const result = await signUpAction({ error: null }, signupForm());
    expect(signUpSpy).toHaveBeenCalledTimes(1);
    expect(result.error).toBe("simulated signup failure");
  });

  it("denies the caller BEFORE signUp() once this IP's own budget is spent — the actual fix", async () => {
    const ip = `192.0.2.${Math.floor(Math.random() * 40) + 60}`;
    testKeys.push(ip);
    setIp(ip);

    // Spend the configured signup budget (5/hour) for this IP.
    for (let i = 0; i < 5; i++) {
      await signUpAction({ error: null }, signupForm());
    }
    expect(signUpSpy).toHaveBeenCalledTimes(5);
    signUpSpy.mockClear();

    // The 6th attempt from the SAME IP must be refused without ever
    // reaching the real signUp endpoint.
    const result = await signUpAction({ error: null }, signupForm());
    expect(signUpSpy).not.toHaveBeenCalled();
    expect(result.error).toMatch(/too many signup attempts/i);
  });
});
