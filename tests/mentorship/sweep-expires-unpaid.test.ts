/**
 * send-502 / S15 — the daily mentorship sweep now expires unpaid bookings (and releases their slots), via the one atomic
 * database function (migration 0203). The sweep itself only decides WHEN to call it and what to report; the guarantee that
 * the expiry and the release are one statement is tested against the real database in unpaid-expiry.test.ts.
 *
 * Unit-level, with a fake service client: what the sweep asks for, and how it reports success and failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  expireResult: { data: [] as Array<{ session_id: string; slot_id: string }>, error: null as { message: string } | null },
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => {
    const emptyList = { data: [], error: null };
    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(emptyList);
          return () => chain;
        },
      },
    );
    return {
      from: () => chain,
      rpc: async (name: string, args: unknown) => {
        state.rpcCalls.push({ name, args });
        return name === "expire_unpaid_mentor_sessions" ? state.expireResult : { data: null, error: null };
      },
    };
  },
}));
vi.mock("@/lib/paystack/client", () => ({ refundTransaction: vi.fn(), isDecline: () => false }));

import { runMentorshipSweep } from "@/lib/mentorship/sweep";

beforeEach(() => {
  state.rpcCalls.length = 0;
  state.expireResult = { data: [], error: null };
});

describe("runMentorshipSweep expires unpaid bookings", () => {
  it("calls the expiry function once, with the current time", async () => {
    const before = Date.now();
    await runMentorshipSweep();
    const calls = state.rpcCalls.filter((c) => c.name === "expire_unpaid_mentor_sessions");
    expect(calls, "the sweep must call expire_unpaid_mentor_sessions").toHaveLength(1);
    const pNow = Date.parse((calls[0].args as { p_now: string }).p_now);
    expect(pNow).toBeGreaterThanOrEqual(before - 1000);
    expect(pNow).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("reports how many bookings it expired", async () => {
    state.expireResult = {
      data: [
        { session_id: "s1", slot_id: "a" },
        { session_id: "s2", slot_id: "b" },
      ],
      error: null,
    };
    const summary = (await runMentorshipSweep()) as { expired?: number; ok: boolean };
    expect(summary.expired).toBe(2);
    expect(summary.ok).toBe(true);
  });

  it("reports zero when there is nothing to expire", async () => {
    const summary = (await runMentorshipSweep()) as { expired?: number };
    expect(summary.expired).toBe(0);
  });

  it("a failed expiry is reported (ok: false, with the error), never swallowed, and does not stop the rest of the sweep", async () => {
    state.expireResult = { data: [], error: { message: "boom" } };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const summary = (await runMentorshipSweep()) as { ok: boolean; expired?: number; errors: Array<{ message: string }> };
    expect(summary.ok).toBe(false);
    expect(summary.expired).toBe(0);
    expect(summary.errors.map((e) => e.message).join(" ")).toContain("boom");
    expect(errors.mock.calls.map((c) => c.join(" ")).join("\n")).toMatch(/expire/i);
    errors.mockRestore();
  });
});
