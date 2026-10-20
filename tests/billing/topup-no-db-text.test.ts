/**
 * The ad-wallet top-up (topUpWalletAction) must not show the database's own error text when the pending payment row cannot be written. The person reads a plain sentence (and that nothing was charged, which is
 * true: this is before Paystack is called); the raw error goes to the server log only, never with an email, a card detail or a token. Nothing about the money changes: the same single insert, no Paystack call on this
 * failure, and the success and Paystack-failure paths are exactly as before. Supabase, Paystack and the router are faked; the action is the real one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  insertError: null as null | { message: string },
  inserts: [] as unknown[],
  updates: [] as unknown[],
  initialize: vi.fn(),
  redirected: null as null | string,
}));

const EMAIL = "owner@acme.example";

vi.mock("next/headers", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/headers")>()), headers: async () => new Headers({ host: "www.example.test", "x-forwarded-proto": "https" }) }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (to: string) => {
    h.redirected = to;
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/employer/membership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/employer/membership")>()),
  requireEmployer: async () => ({ userId: "user-1", userEmail: EMAIL, role: "owner", organization: { id: "org-1", name: "Acme" } }),
}));
vi.mock("@/lib/paystack/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/paystack/client")>()), initializeTransaction: (...a: unknown[]) => h.initialize(...a) }));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()),
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      insert: async (row: unknown) => {
        h.inserts.push({ table, row });
        return { error: h.insertError };
      },
      update: (patch: unknown) => ({
        eq: async () => {
          h.updates.push({ table, patch });
          return { error: null };
        },
      }),
    }),
  }),
}));

import { topUpWalletAction } from "@/lib/employer/wallet-actions";

const MARKER = 'relation "payment_transactions_zz_marker_8841" violates check constraint "payment_transactions_reference_check"';
const PLAIN = "Couldn't start the top-up. Nothing was charged. Please try again, or contact support if it keeps happening.";
const form = (amount: string) => {
  const f = new FormData();
  f.set("amount", amount);
  return f;
};
let errorLog: ReturnType<typeof vi.spyOn>;
const logged = () => errorLog.mock.calls.map((c: unknown[]) => c.map(String).join(" ")).join("\n");

beforeEach(() => {
  h.insertError = null;
  h.inserts = [];
  h.updates = [];
  h.redirected = null;
  h.initialize.mockReset().mockResolvedValue({ authorization_url: "https://checkout.paystack.test/abc" });
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  errorLog.mockClear();
});

describe("the pending payment row cannot be written", () => {
  beforeEach(() => {
    h.insertError = { message: MARKER };
  });
  it("shows a plain sentence with none of the database text", async () => {
    const out = await topUpWalletAction(null, form("5,000"));
    expect(out).toEqual({ error: PLAIN });
    expect(JSON.stringify(out)).not.toContain("zz_marker_8841");
    expect(JSON.stringify(out)).not.toContain("violates");
    expect(JSON.stringify(out)).not.toContain("payment_transactions");
  });
  it("logs the raw error server-side with the ids, and no email, card detail or token", async () => {
    await topUpWalletAction(null, form("5000"));
    const log = logged();
    expect(log).toContain("zz_marker_8841");
    expect(log).toContain("topUpWalletAction");
    expect(log).toContain("user-1");
    expect(log).toContain("org-1");
    expect(log).not.toContain(EMAIL);
    expect(log).not.toContain("@");
    expect(log).not.toMatch(/authorization|token|card|secret/i);
  });
  it("changes nothing about the money: exactly one insert attempt, no Paystack call, no redirect, no status update", async () => {
    await topUpWalletAction(null, form("5000"));
    expect(h.inserts).toHaveLength(1);
    expect(h.initialize).not.toHaveBeenCalled();
    expect(h.redirected).toBeNull();
    expect(h.updates).toEqual([]);
  });
});

describe("the other paths are exactly as before", () => {
  it("success: one pending row with the same fields, Paystack is initialised with the same reference, then the redirect", async () => {
    await expect(topUpWalletAction(null, form("₦5,000"))).rejects.toThrow("NEXT_REDIRECT https://checkout.paystack.test/abc");
    expect(h.inserts).toHaveLength(1);
    const { table, row } = h.inserts[0] as { table: string; row: Record<string, unknown> };
    expect(table).toBe("payment_transactions");
    expect(row).toMatchObject({ user_id: "user-1", organization_id: "org-1", rail: "paystack", amount: 5000, currency: "NGN", product_type: "ad_wallet_topup", product_id: null, status: "pending" });
    expect(String(row.paystack_reference)).toMatch(/^ad_wallet_topup_[0-9a-f-]{36}$/);
    expect(h.initialize).toHaveBeenCalledTimes(1);
    const init = h.initialize.mock.calls[0][0] as Record<string, unknown>;
    expect(init).toMatchObject({ email: EMAIL, amountNgn: 5000, reference: row.paystack_reference, callbackUrl: "https://www.example.test/employer/campaigns/topup-callback" });
    expect(errorLog).not.toHaveBeenCalled();
  });
  it("Paystack unreachable: the same sentence, and the pending row is marked failed", async () => {
    h.initialize.mockRejectedValue(new Error("network"));
    const out = await topUpWalletAction(null, form("5000"));
    expect(out).toEqual({ error: "Couldn't reach Paystack just now. Try again in a moment." });
    expect(h.updates).toEqual([{ table: "payment_transactions", patch: { status: "failed" } }]);
  });
  it("the amount limits still answer as before", async () => {
    expect(await topUpWalletAction(null, form("500"))).toEqual({ error: "Top up at least ₦1,000." });
    expect(await topUpWalletAction(null, form("6000000"))).toEqual({ error: "That's above the ₦5,000,000 single top-up limit." });
    expect(h.inserts).toEqual([]);
  });
});
