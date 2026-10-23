/**
 * V4: the daily mentorship sweep also returns stale human resume-review claims to the pool, by calling the one database function (release_stale_verification_claims, migration 0267).
 * The release itself is proven against the real database in tests/talent-directory/claim-timeout.test.ts; this file proves what the sweep asks for and how it reports. No new cron.
 *
 * Unit-level, with a fake service client that answers like the real one: rpc returns a thenable with { data, error } (supabase-js's builder has no .catch), table calls return an empty list.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ kind: "rpc" | "from"; name: string; args?: unknown }>,
  expire: { data: [] as unknown[] | null, error: null as { message: string } | null },
  release: { data: 0 as number | null, error: null as { message: string } | null },
  releaseRejects: null as Error | null,
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => {
    const empty = { data: [], error: null };
    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(empty);
          return () => chain;
        },
      },
    );
    return {
      from: (name: string) => {
        state.calls.push({ kind: "from", name });
        return chain;
      },
      rpc: (name: string, args: unknown) => {
        state.calls.push({ kind: "rpc", name, args });
        return {
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
            if (name === "release_stale_verification_claims") {
              if (state.releaseRejects) return reject ? reject(state.releaseRejects) : undefined;
              return resolve(state.release);
            }
            return resolve(name === "expire_unpaid_mentor_sessions" ? state.expire : { data: null, error: null });
          },
        };
      },
    };
  },
}));
vi.mock("@/lib/paystack/client", () => ({ refundTransaction: vi.fn(), isDecline: () => false }));

import { runMentorshipSweep } from "@/lib/mentorship/sweep";

const rpcCalls = (name: string) => state.calls.filter((c) => c.kind === "rpc" && c.name === name);

beforeEach(() => {
  state.calls.length = 0;
  state.expire = { data: [], error: null };
  state.release = { data: 0, error: null };
  state.releaseRejects = null;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.mocked(console.log).mockClear();
  vi.mocked(console.error).mockClear();
});

describe("the sweep releases stale review claims", () => {
  it("calls release_stale_verification_claims once, with only the clock (the 72 hours lives in the database)", async () => {
    const before = Date.now();
    await runMentorshipSweep();
    const calls = rpcCalls("release_stale_verification_claims");
    expect(calls).toHaveLength(1);
    const args = calls[0].args as Record<string, unknown>;
    expect(Object.keys(args)).toEqual(["p_now"]);
    const sent = new Date(args.p_now as string).getTime();
    expect(sent).toBeGreaterThanOrEqual(before);
    expect(sent).toBeLessThanOrEqual(Date.now());
  });

  it("reports the number the function returned", async () => {
    state.release = { data: 4, error: null };
    const summary = await runMentorshipSweep();
    expect(summary.verificationClaimsReleased).toBe(4);
    expect(summary.ok).toBe(true);
    expect(summary.errors).toEqual([]);
  });

  it("reports zero when nothing was stale", async () => {
    const summary = await runMentorshipSweep();
    expect(summary.verificationClaimsReleased).toBe(0);
    expect(summary.ok).toBe(true);
  });

  it("logs a count only when something was released", async () => {
    await runMentorshipSweep();
    expect(vi.mocked(console.log)).not.toHaveBeenCalled();
    state.release = { data: 2, error: null };
    await runMentorshipSweep();
    expect(vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join("\n")).toContain("released 2 stale verification claim");
  });
});

describe("a failure is reported, and the rest of the sweep still runs", () => {
  it("an error from the function marks the run not-ok and names the step, with the database's message", async () => {
    state.release = { data: null, error: { message: "boom from the database" } };
    const summary = await runMentorshipSweep();
    expect(summary.ok).toBe(false);
    expect(summary.verificationClaimsReleased).toBe(0);
    expect(summary.errors).toEqual([{ sessionId: "release_stale_verification_claims", message: "boom from the database" }]);
  });

  it("a thrown error is caught and reported the same way (the sweep does not throw)", async () => {
    state.releaseRejects = new Error("network down");
    const summary = await runMentorshipSweep();
    expect(summary.ok).toBe(false);
    expect(summary.errors).toEqual([{ sessionId: "release_stale_verification_claims", message: "network down" }]);
  });

  it("the no-show work-list query still runs after a failed release", async () => {
    state.release = { data: null, error: { message: "boom" } };
    await runMentorshipSweep();
    const releaseAt = state.calls.findIndex((c) => c.kind === "rpc" && c.name === "release_stale_verification_claims");
    expect(releaseAt).toBeGreaterThanOrEqual(0);
    expect(state.calls.slice(releaseAt + 1).some((c) => c.kind === "from" && c.name === "mentorship_sessions")).toBe(true);
  });

  it("a failed unpaid-booking expiry does not stop the release, and the release does not hide the expiry's failure", async () => {
    state.expire = { data: null, error: { message: "expiry failed" } };
    state.release = { data: 3, error: null };
    const summary = await runMentorshipSweep();
    expect(summary.verificationClaimsReleased).toBe(3);
    expect(summary.ok).toBe(false);
    expect(summary.errors).toEqual([{ sessionId: "expire_unpaid_mentor_sessions", message: "expiry failed" }]);
  });
});

describe("the sweep's existing behaviour is unchanged", () => {
  it("still calls the unpaid-booking expiry once and reports its count", async () => {
    state.expire = { data: [{ session_id: "a" }, { session_id: "b" }], error: null };
    const summary = await runMentorshipSweep();
    expect(rpcCalls("expire_unpaid_mentor_sessions")).toHaveLength(1);
    expect(summary.expired).toBe(2);
  });

  it("keeps every field it had, in the same shape, and adds only verificationClaimsReleased", async () => {
    const summary = await runMentorshipSweep();
    expect(Object.keys(summary).sort()).toEqual(["cancelled", "considered", "errors", "expired", "ok", "refundFailed", "refunded", "verificationClaimsReleased"]);
    expect({ ...summary, verificationClaimsReleased: undefined }).toEqual({ ok: true, expired: 0, considered: 0, cancelled: 0, refunded: 0, refundFailed: 0, errors: [], verificationClaimsReleased: undefined });
  });

  it("makes no other call to the verification table (the release is the one database function, not a read-then-write here)", async () => {
    await runMentorshipSweep();
    expect(state.calls.filter((c) => c.kind === "from" && c.name === "talent_verifications")).toEqual([]);
  });
});
