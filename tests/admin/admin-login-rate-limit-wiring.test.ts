/**
 * adminLoginAction's own per-IP throttle (src/lib/admin/actions.ts) —
 * mirrors tests/auth/signin-rate-limit-wiring.test.ts for the admin path,
 * proving the wiring end-to-end against the REAL rate limiter with only the
 * Supabase auth call mocked.
 *
 * `passwordCheckClient()` in actions.ts builds its client straight from
 * `@supabase/supabase-js`, not from `@/lib/supabase/server` — so that's the
 * module this file has to mock. But `createServiceRoleClient()` (used below
 * for this file's OWN setup/cleanup) goes through the exact same package
 * underneath, so a blanket mock would swallow this file's real database
 * access along with it. The mock factory below dispatches on the KEY the
 * caller passed — the anon key (what `passwordCheckClient` uses) gets the
 * spy, anything else (the service-role key this file's own cleanup uses)
 * gets the real client, via `importActual`.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const signInSpy = vi.hoisted(() =>
  vi.fn(async () => ({ data: { user: null }, error: { message: "Invalid login credentials" } })),
);
const headerStore = vi.hoisted(() => ({ current: new Map<string, string>() }));

vi.mock("@supabase/supabase-js", async () => {
  const actual = await vi.importActual<typeof import("@supabase/supabase-js")>("@supabase/supabase-js");
  return {
    ...actual,
    createClient: (url: string, key: string, ...rest: unknown[]) => {
      if (key === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        return { auth: { signInWithPassword: signInSpy } };
      }
      // @ts-expect-error — passthrough to the real implementation for
      // every other caller (this file's own service-role cleanup client).
      return actual.createClient(url, key, ...rest);
    },
  };
});

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => headerStore.current.get(name) ?? null,
  }),
}));

const { adminLoginAction } = await import("@/lib/admin/actions");
const { initialAdminLoginState } = await import("@/lib/admin/login-state");

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
    const admin = createServiceRoleClient();
    const { error } = await admin.from("anonymous_rate_limits").delete().in("rate_key", testKeys);
    if (error) console.warn(`[cleanup] could not delete fixture rate-limit rows: ${error.message}`);
  }
});

describe("adminLoginAction's per-IP rate limit", () => {
  it("allows ordinary attempts through to the real signInWithPassword call", async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 100) + 1}`;
    testKeys.push(ip);
    setIp(ip);

    const result = await adminLoginAction(initialAdminLoginState, loginForm());
    expect(signInSpy).toHaveBeenCalledTimes(1);
    expect(result.error).toBe("Incorrect email or password.");
  });

  it("denies the caller BEFORE signInWithPassword once this IP's (tighter) budget is spent — the actual fix", async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 100) + 150}`;
    testKeys.push(ip);
    setIp(ip);

    // Spend the configured admin-login budget (8/15min) for this IP.
    for (let i = 0; i < 8; i++) {
      await adminLoginAction(initialAdminLoginState, loginForm());
    }
    expect(signInSpy).toHaveBeenCalledTimes(8);
    signInSpy.mockClear();

    // The 9th attempt from the SAME IP must be refused, identically to
    // every other rejection (see admin/actions.ts's GENERIC_FAILURE
    // rationale — a rate-limited response must give a guesser no more
    // signal than a wrong password does), and never reach real auth.
    const result = await adminLoginAction(initialAdminLoginState, loginForm());
    expect(signInSpy).not.toHaveBeenCalled();
    expect(result.error).toBe("Incorrect email or password.");
  });
});
