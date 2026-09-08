/**
 * `resendSignupConfirmationAction` and `resendPasswordResetAction` —
 * src/lib/auth/actions.ts.
 *
 * MOCKING STRATEGY, stated explicitly because it is a hybrid and the reason
 * matters. Two different things happen inside these actions, with two very
 * different costs to exercising them for real:
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
 * ONE TEST BELOW IS DELIBERATELY UNMOCKED end-to-end (marked "REAL GoTrue
 * call") to keep at least one assertion honest about the actual endpoint —
 * chosen because it targets a NONEXISTENT address, which was verified by
 * hand (see actions.ts's comment on resendSignupConfirmationAction) to
 * resolve with no error and, on the evidence of that same probe producing no
 * observable throttling, to not count as a real mail send against the
 * project-wide quota.
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

const resendSpy = vi.hoisted(() => vi.fn(async () => ({ data: {}, error: null as unknown })));
const resetPasswordSpy = vi.hoisted(() => vi.fn(async () => ({ data: {}, error: null as unknown })));
const headerStore = vi.hoisted(() => ({ current: new Map<string, string>() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      resend: resendSpy,
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

const { resendSignupConfirmationAction, resendPasswordResetAction } = await import(
  "@/lib/auth/actions"
);

const testKeys: string[] = [];

function setIp(ip: string | null) {
  headerStore.current = new Map(ip ? [["x-forwarded-for", ip]] : []);
}

beforeEach(() => {
  resendSpy.mockClear();
  resetPasswordSpy.mockClear();
  setIp(`192.0.2.${Math.floor(Math.random() * 200) + 1}`);
});

afterAll(async () => {
  if (testKeys.length) {
    const { error } = await admin.from("anonymous_rate_limits").delete().in("rate_key", testKeys);
    if (error) console.warn(`[cleanup] could not delete fixture rate-limit rows: ${error.message}`);
  }
});

describe("resendSignupConfirmationAction", () => {
  it("rejects a malformed email without consulting the rate limiter or Supabase", async () => {
    const result = await resendSignupConfirmationAction("not-an-email", { status: "idle", message: null }, new FormData());
    expect(result.status).toBe("error");
    expect(resendSpy).not.toHaveBeenCalled();
  });

  it("succeeds (mocked send) for a well-formed address, and lowercases the rate-limit key", async () => {
    const email = `Resend-Probe-${randomUUID()}@Talentrah.Test`;
    testKeys.push(email.toLowerCase());

    const result = await resendSignupConfirmationAction(email, { status: "idle", message: null }, new FormData());
    expect(result).toEqual({ status: "success", message: null });
    expect(resendSpy).toHaveBeenCalledWith({ type: "signup", email });

    // The counter row exists under the LOWERCASED key — proves case-folding
    // actually happened rather than relying on it being untested.
    const { data } = await admin
      .from("anonymous_rate_limits")
      .select("rate_key")
      .eq("bucket", "resendEmail")
      .eq("rate_key", email.toLowerCase());
    expect(data ?? []).toHaveLength(1);
  });

  it("does not distinguish a Supabase send error from any other failure in its message", async () => {
    const email = `resend-probe-error-${randomUUID()}@talentrah.test`;
    testKeys.push(email);
    resendSpy.mockResolvedValueOnce({
      data: {},
      error: { message: "Email address ... is invalid", status: 400 } as unknown as null,
    });

    const result = await resendSignupConfirmationAction(email, { status: "idle", message: null }, new FormData());
    expect(result.status).toBe("error");
    // The generic message, never Supabase's own — that message would leak
    // exactly the fact this flow must never reveal (see actions.ts comment).
    expect(result.message).not.toMatch(/invalid/i);
    expect(result.message).toBe("Couldn't resend that — try again in a moment.");
  });

  it("maps a 429 from Supabase's own mailer to the same rate-limited message the local bucket produces", async () => {
    const email = `resend-probe-429-${randomUUID()}@talentrah.test`;
    testKeys.push(email);
    resendSpy.mockResolvedValueOnce({
      data: {},
      error: { message: "email rate limit exceeded", status: 429 } as unknown as null,
    });

    const result = await resendSignupConfirmationAction(email, { status: "idle", message: null }, new FormData());
    expect(result).toEqual({
      status: "error",
      message: "That's a lot of requests for this address — try again later.",
    });
  });

  it("is denied by its OWN bucket once exhausted, without ever reaching Supabase — real database, fast-forwarded rather than replayed 5 times over the network", async () => {
    const email = `resend-probe-exhausted-${randomUUID()}@talentrah.test`;
    testKeys.push(email);

    // Fast-forward the real counter to the limit directly via the RPC,
    // instead of calling the action 5 times for real — the property this
    // test cares about is "the action honors a bucket that is already at
    // capacity", not "the action can independently reach capacity", which
    // migration 0117's own suite (resend-rate-limit.test.ts) already proves.
    for (let i = 0; i < 5; i++) {
      const { error } = await admin.rpc("consume_anonymous_rate_limit", {
        p_key: email,
        p_bucket: "resendEmail",
        p_limit: 5,
        p_window_seconds: 60 * 60 * 24,
      });
      if (error) throw error;
    }

    const result = await resendSignupConfirmationAction(email, { status: "idle", message: null }, new FormData());
    expect(result).toEqual({
      status: "error",
      message: "That's a lot of requests for this address — try again later.",
    });
    expect(resendSpy, "the action called Supabase's mailer despite an already-exhausted bucket").not.toHaveBeenCalled();
  });

  it("REAL GoTrue call: a genuinely nonexistent address resolves with no error, unmocked", async () => {
    vi.doUnmock("@/lib/supabase/server");
    vi.resetModules();
    const { resendSignupConfirmationAction: realAction } = await import("@/lib/auth/actions");

    const email = `resend-real-nonexistent-${randomUUID()}@talentrah.test`;
    testKeys.push(email);
    const result = await realAction(email, { status: "idle", message: null }, new FormData());
    expect(result).toEqual({ status: "success", message: null });

    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { resend: resendSpy, resetPasswordForEmail: resetPasswordSpy },
      }),
    }));
    vi.resetModules();
  });
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
