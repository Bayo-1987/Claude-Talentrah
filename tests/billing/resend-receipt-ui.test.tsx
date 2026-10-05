/**
 * The billing page's side of "Email me this receipt": a button on each credit-pack and pass row (and only those), bound to that row's id,
 * and one plain banner per outcome the action can redirect back with. Same fake-Supabase harness as billing-page-states.test.tsx.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

const world = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]>, bound: [] as Array<{ action: string; args: unknown[] }> }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ profile: { id: "u1", credits_balance: 12, country: "Nigeria" }, user: { id: "u1" } }) }));
vi.mock("@/lib/billing/actions", () => ({ initiatePurchaseAction: Object.assign(async () => {}, { bind: () => async () => {} }), cancelAutoRenewAction: Object.assign(async () => {}, { bind: () => async () => {} }) }));
vi.mock("@/lib/billing/receipt-actions", () => ({
  resendReceiptAction: Object.assign(async () => {}, { bind: (_t: unknown, ...args: unknown[]) => { world.bound.push({ action: "resendReceipt", args }); return async () => {}; } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from(t: string) { const c: Record<string, unknown> = new Proxy({}, { get: (_x, p) => (p === "then" ? (r: (v: unknown) => unknown) => r({ data: world.rows[t] ?? [], error: null }) : () => c) }); return c; } }),
}));
import BillingPage from "@/app/(app)/billing/page";

const tx = (id: string, product_type: string, ref: string | null) => ({ id, amount: 2500, currency: "NGN", product_type, product_id: null, rail: "paystack", channel: "card", paystack_reference: ref, created_at: "2026-10-01T10:00:00.000Z" });
beforeEach(() => {
  world.bound = [];
  world.rows = {
    credit_packs: [{ id: "pk1", name: "Starter", credits: 20, price_ngn: 2500 }],
    passes: [{ id: "ps7", name: "7-Day Sprint Pass", duration_days: 7, price_ngn: 6500 }],
    user_passes: [],
    payment_transactions: [
      tx("t-pack", "credit_pack", "credit_pack_11111111-9f2e-4c3a-8d11-0a1b2c3d4e5f"),
      tx("t-pass", "pass", "pass_22222222-9f2e-4c3a-8d11-0a1b2c3d4e5f"),
      tx("t-wallet", "ad_wallet_topup", "ad_wallet_topup_33333333-9f2e-4c3a-8d11-0a1b2c3d4e5f"),
      tx("t-noref", "credit_pack", null),
    ],
  };
});
const render = async (sp: Record<string, string> = {}) => renderToString(await BillingPage({ searchParams: Promise.resolve(sp) }));
const text = (h: string) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("the button", () => {
  it("is on credit-pack and pass rows that have a reference, bound to that row's id, and nowhere else", async () => {
    const html = await render();
    expect(text(html).match(/Email me this receipt/g)).toHaveLength(2);
    expect(world.bound.map((b) => b.args[0]).sort()).toEqual(["t-pack", "t-pass"]);
  });
  it("is a real button at least 44px tall", async () => {
    const html = await render();
    expect(html).toMatch(/<button[^>]*min-h-\[44px\][^>]*>Email me this receipt<\/button>/);
  });
  it("first visit (no purchases) has none", async () => {
    world.rows.payment_transactions = [];
    expect(text(await render())).not.toContain("Email me this receipt");
  });
});

describe("the outcome banner", () => {
  const say: Record<string, string> = {
    sent: "Receipt sent to your email.",
    limited: `You've sent ${RATE_LIMITS.receiptResend.limit} receipt emails in the last 24 hours. Try again later.`,
    unavailable: "Receipt email isn't available right now.",
    failed: "We couldn't send that receipt just now. Try again in a little while.",
    not_found: "We couldn't find that purchase.",
  };
  for (const [code, sentence] of Object.entries(say)) {
    it(`?receipt=${code} says: ${sentence}`, async () => {
      const html = await render({ receipt: code });
      expect(text(html)).toContain(sentence);
      expect(html).toMatch(/role="status"/);
    });
  }
  it("no parameter, no banner; an unknown code, no banner", async () => {
    for (const sp of [{}, { receipt: "zzz" }, { receipt: "constructor" }, { receipt: "toString" }, { receipt: "__proto__" }] as Array<Record<string, string>>) expect(text(await render(sp))).not.toMatch(/Receipt sent|We couldn't send that receipt|We couldn't find that purchase/);
  });
});
