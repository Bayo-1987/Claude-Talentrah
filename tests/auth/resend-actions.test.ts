/**
 * `resendPasswordResetAction` — src/lib/auth/actions.ts. (The signup resend is now a code resend: tests/auth/signup-code-actions.test.ts.)
 *
 * MOCKING STRATEGY, stated explicitly because it is a hybrid and the reason
 * matters. Two different things happen inside these actions, with two very
 * different costs to exercising it for real:
 *
 *   1. The rate-limit consult (`consumeResendRateLimit`, migration 0117) is
 *      cheap, idempotent-to-repeat, and IS the property most worth proving
 *      against a real database — same reasoning as tests/api/rate-limit.test.ts.
 *      This suite does NOT mock `@/lib/supabase/service-role`, so every call
 *      here hits the real `anonymous_rate_limits` table.
 *
 *   2. `supabase.auth.resend` / `resetPasswordForEmail` calls Supabase's own
 *      mailer, which — measured live against the CI project, not assumed
 *      (see actions.ts's own comment and docs/admin-auth.md) — is throttled
 *      to just TWO sends per hour, PROJECT-WIDE, and is SHARED by every
 *      session working in this repo (scripts/db-target.ts). A suite that
 *      called the real endpoint on every run would either exhaust that
 *      quota for everyone else or silently start asserting on 429s instead
 *      of the behavior under test. So `@/lib/supabase/server`'s `createClient`
 *      is mocked to a stub whose `auth.resend`/`auth.resetPasswordForEmail`
 *      are controllable spies, same pattern as create-resume-action.test.ts
 *      and pass-covered-actions.test.ts mocking the same module.
 *
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Resend action test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const resetPasswordSpy = vi.hoisted(() => vi.fn(async () => ({ data: {}, error: null as unknown })));
const headerStore = vi.hoisted(() => ({ current: new Map<string, string>() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      resetPasswordForEmail: resetPasswordSpy,
    },
  }),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => headerStore.current.get(name) ?? null,
  }),
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
    delete: () => {},
  }),
}));

const { resendPasswordResetAction } = await import(
  "@/lib/auth/actions"
);

const testKeys: string[] = [];

function setIp(ip: string | null) {
  headerStore.current = new Map(ip ? [["x-forwarded-for", ip]] : []);
}

beforeEach(() => {
  resetPasswordSpy.mockClear();
  setIp(`192.0.2.${Math.floor(Math.random() * 200) + 1}`);
});

afterAll(async () => {
  if (testKeys.length) {
    const { error } = await admin.from("anonymous_rate_limits").delete().in("rate_key", testKeys);
    if (error) console.warn(`[cleanup] could not delete fixture rate-limit rows: ${error.message}`);
  }
});

describe("resendPasswordResetAction", () => {
  it("calls resetPasswordForEmail with the same redirect shape requestPasswordResetAction uses", async () => {
    const email = `resend-pw-probe-${randomUUID()}@talentrah.test`;
    testKeys.push(email);

    const result = await resendPasswordResetAction(email, { status: "idle", message: null }, new FormData());
    expect(result).toEqual({ status: "success", message: null });
    expect(resetPasswordSpy).toHaveBeenCalledWith(
      email,
      expect.objectContaining({ redirectTo: expect.stringMatching(/\/auth\/callback\?next=\/reset-password$/) }),
    );
  });

  it("never surfaces whether the address exists, on any error", async () => {
    const email = `resend-pw-probe-error-${randomUUID()}@talentrah.test`;
    testKeys.push(email);
    resetPasswordSpy.mockResolvedValueOnce({
      data: {},
      error: { message: "some internal Supabase detail", status: 500 } as unknown as null,
    });

    const result = await resendPasswordResetAction(email, { status: "idle", message: null }, new FormData());
    expect(result.message).toBe("Couldn't resend that — try again in a moment.");
  });

  it("shares the anonymous rate limiter with the signup resend action (same email bucket name)", async () => {
    const email = `resend-pw-probe-shared-bucket-${randomUUID()}@talentrah.test`;
    testKeys.push(email);

    await resendPasswordResetAction(email, { status: "idle", message: null }, new FormData());

    // Same bucket name ("resendEmail") consumeResendRateLimit uses for the
    // signup flow — proves both actions share migration 0117's table rather
    // than each growing its own limiter.
    const { data } = await admin
      .from("anonymous_rate_limits")
      .select("bucket")
      .eq("rate_key", email)
      .eq("bucket", "resendEmail");
    expect(data ?? []).toHaveLength(1);
  });
});
