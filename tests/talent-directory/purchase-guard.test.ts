/**
 * EMP-1 / E1 — hiding the Subscribe button is not a gate.
 *
 * `purchaseTalentDirectorySubscriptionAction` is a Server Action: anyone who can see the page once can POST it again later, and a stale
 * tab from before the pool shrank can submit it too. The founder's rule is that below TALENT_DIRECTORY_MIN_LISTED candidates there is
 * NO CHARGE, so the action itself refuses, before it inserts a subscription row or touches Paystack. The count it reads is the same
 * gated count the preview shows (talent_directory_listed_count), through the service role.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  listedCount: 0,
  inserts: [] as Array<{ table: string; row: unknown }>,
  paystackCalls: 0,
  rpcCalls: [] as string[],
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000" }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock("@/lib/employer/membership", () => ({
  requireEmployer: async () => ({
    userId: "user-1",
    userEmail: "owner@example.com",
    emailConfirmed: true,
    organization: { id: "org-1" },
    role: "owner",
  }),
}));

vi.mock("@/lib/paystack/client", () => ({
  NGN_CHANNELS: ["card"],
  initializeTransaction: async () => {
    state.paystackCalls += 1;
    return { authorization_url: "https://paystack.example/checkout" };
  },
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    rpc: async (name: string) => {
      state.rpcCalls.push(name);
      if (name === "talent_directory_listed_count") return { data: state.listedCount, error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from: (table: string) => {
      let inserted = false;
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.or = () => q; // the already-active check asks for a running or renewing row
      q.limit = () => q;
      q.update = () => q;
      q.insert = (row: unknown) => {
        state.inserts.push({ table, row });
        inserted = true;
        return q;
      };
      q.maybeSingle = async () => {
        if (table === "talent_directory_plans") return { data: { id: "plan-1", price_ngn: 200000, duration_days: 30 }, error: null };
        if (table === "talent_directory_subscriptions" && inserted) return { data: { id: "sub-1" }, error: null };
        return { data: null, error: null };
      };
      // payment_transactions insert is awaited directly
      q.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
      return q;
    },
  }),
}));

import { purchaseTalentDirectorySubscriptionAction } from "@/lib/talent-directory/subscription-actions";
import { TALENT_DIRECTORY_MIN_LISTED } from "@/lib/talent-directory/preview";

async function run(): Promise<string> {
  try {
    await purchaseTalentDirectorySubscriptionAction("plan-1");
  } catch (e) {
    return (e as Error).message;
  }
  return "RETURNED";
}

beforeEach(() => {
  state.listedCount = 0;
  state.inserts = [];
  state.paystackCalls = 0;
  state.rpcCalls = [];
});

describe("purchaseTalentDirectorySubscriptionAction: the pool threshold", () => {
  it("refuses at 9 listed candidates: no subscription row, no payment row, no Paystack call", async () => {
    state.listedCount = TALENT_DIRECTORY_MIN_LISTED - 1;
    const outcome = await run();
    expect(outcome).toMatch(/^REDIRECT:\/employer\/talent-directory\?error=/);
    expect(decodeURIComponent(outcome)).toMatch(/building the directory/i);
    expect(state.inserts).toEqual([]);
    expect(state.paystackCalls).toBe(0);
  });

  it("refuses at 0 and at 1 (production's measured pool)", async () => {
    for (const n of [0, 1]) {
      state.listedCount = n;
      state.inserts = [];
      const outcome = await run();
      expect(outcome).toMatch(/error=/);
      expect(state.inserts).toEqual([]);
      expect(state.paystackCalls).toBe(0);
    }
  });

  it("proceeds at exactly 10: a pending subscription, a pending payment, and the Paystack redirect", async () => {
    state.listedCount = TALENT_DIRECTORY_MIN_LISTED;
    const outcome = await run();
    expect(outcome).toBe("REDIRECT:https://paystack.example/checkout");
    expect(state.inserts.map((i) => i.table)).toEqual(["talent_directory_subscriptions", "payment_transactions"]);
    expect(state.paystackCalls).toBe(1);
  });

  it("reads the gated count through the shared helper, not by counting profiles itself", async () => {
    state.listedCount = 50;
    await run();
    expect(state.rpcCalls).toEqual(["talent_directory_listed_count"]);
  });

  it("an unreadable count fails closed (no charge)", async () => {
    state.listedCount = Number.NaN;
    const outcome = await run();
    expect(outcome).toMatch(/error=/);
    expect(state.paystackCalls).toBe(0);
  });
});
