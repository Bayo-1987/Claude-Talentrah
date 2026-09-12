/**
 * signInAction's own per-IP throttle (src/lib/auth/actions.ts) — proves the
 * WIRING end-to-end against the REAL rate limiter (same reasoning
 * tests/auth/resend-actions.test.ts already applies to the sibling resend
 * actions: the rate-limit consult is cheap and real-database behavior is
 * exactly the property worth proving, so only the Supabase auth call itself
 * is mocked). login-rate-limit.test.ts already proves the underlying module
 * enforces its configured numbers atomically; this proves signInAction
 * actually calls it, and calls it BEFORE signInWithPassword.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`signInAction rate-limit test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const signInSpy = vi.hoisted(() =>
  vi.fn(async () => ({ data: {}, error: { message: "Invalid login credentials" } })),
);
const headerStore = vi.hoisted(() => ({ current: new Map<string, string>() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signInWithPassword: signInSpy },
  }),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => headerStore.current.get(name) ?? null,
  }),
  cookies: async () => ({ getAll: () => [], set: () => {}, delete: () => {} }),
}));

const { signInAction } = await import("@/lib/auth/actions");

function setIp(ip: string) {
  headerStore.current = new Map([["x-forwarded-for", ip]]);
}

function loginForm() {
  const fd = new FormData();
  fd.set("email", "prober@talentrah.test");
  fd.set("password", "wrong-password-on-purpose");
  return fd;
}

const testKeys: string[] = [];

beforeEach(() => {
  signInSpy.mockClear();
});

afterAll(async () => {
  if (testKeys.length) {
    const { error } = await admin.from("anonymous_rate_limits").delete().in("rate_key", testKeys);
    if (error) console.warn(`[cleanup] could not delete fixture rate-limit rows: ${error.message}`);
  }
});

describe("signInAction's per-IP rate limit", () => {
  it("allows ordinary attempts through to the real signInWithPassword call", async () => {
    const ip = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
    testKeys.push(ip);
    setIp(ip);

    const result = await signInAction({ error: null }, loginForm());
    expect(signInSpy).toHaveBeenCalledTimes(1);
    expect(result.error).toBe("Incorrect email or password.");
  });

  it("denies the caller BEFORE signInWithPassword once this IP's own budget is spent — the actual fix", async () => {
    const ip = `192.0.2.${Math.floor(Math.random() * 55) + 200}`;
    testKeys.push(ip);
    setIp(ip);

    // Spend the configured seeker-login budget (20/15min) for this IP.
    for (let i = 0; i < 20; i++) {
      await signInAction({ error: null }, loginForm());
    }
    expect(signInSpy).toHaveBeenCalledTimes(20);
    signInSpy.mockClear();

    // The 21st attempt from the SAME IP must be refused without ever
    // reaching the real auth endpoint — this is the actual protection:
    // Supabase's own shared-ceiling rate limit never even sees this call.
    const result = await signInAction({ error: null }, loginForm());
    expect(signInSpy).not.toHaveBeenCalled();
    expect(result.error).toMatch(/too many attempts/i);
  });
});
