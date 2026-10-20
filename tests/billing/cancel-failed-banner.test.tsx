/**
 * The billing page shows /billing?error=cancel_failed as a banner in the same markup as payments_unavailable, with the exact words, and keeps the Cancel button.
 * Rendered with the same fake Supabase client pattern as tests/billing/billing-page-states.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const world = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]>, bound: [] as Array<{ action: string; args: unknown[] }> }));
vi.mock("@/lib/auth/require-user", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/require-user")>()),
  requireUser: async () => ({ profile: { id: "u1", credits_balance: 12, country: "Nigeria" }, user: { id: "u1" } }),
}));
vi.mock("@/lib/billing/actions", () => {
  const spy = (name: string) => Object.assign(async () => {}, { bind: (_t: unknown, ...args: unknown[]) => { world.bound.push({ action: name, args }); return async () => {}; } });
  return { initiatePurchaseAction: spy("initiatePurchase"), cancelAutoRenewAction: spy("cancelAutoRenew") };
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const chain: Record<string, unknown> = new Proxy({}, {
        get: (_t, prop) => {
          if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ data: world.rows[table] ?? [], error: null });
          return () => chain;
        },
      });
      return chain;
    },
  }),
}));

import BillingPage from "@/app/(app)/billing/page";

const iso = (offset: number) => new Date(NOW + offset).toISOString();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  world.bound = [];
  world.rows = {
    credit_packs: [{ id: "pk1", name: "Starter", credits: 20, price_ngn: 2500 }],
    passes: [{ id: "ps30", name: "30-Day Pass", duration_days: 30, price_ngn: 13500 }],
    user_passes: [{ id: "up1", pass_id: "ps30", payment_method: "card", auto_renew_status: "active", next_renewal_date: "2026-10-22", expires_at: iso(18 * DAY), started_at: iso(-12 * DAY), payment_transaction_id: "t1", status: "active", passes: { name: "30-Day Pass" } }],
    payment_transactions: [],
  };
});
afterEach(() => vi.useRealTimers());

const render = async (searchParams: { error?: string } = {}) => renderToString(await BillingPage({ searchParams: Promise.resolve(searchParams) }));
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("?error=cancel_failed", () => {
  it("shows the exact words", async () => {
    expect(text(await render({ error: "cancel_failed" }))).toContain("We could not cancel your renewal. Please try again.");
  });

  it("uses the same banner markup as payments_unavailable", async () => {
    const cancel = await render({ error: "cancel_failed" });
    const payments = await render({ error: "payments_unavailable" });
    const bannerClass = (html: string) => html.match(/<p class="([^"]*bg-rust-soft[^"]*)"/)?.[1];
    expect(bannerClass(cancel)).toBeDefined();
    expect(bannerClass(cancel)).toBe(bannerClass(payments));
  });

  it("keeps the Cancel auto-renewal button, bound to the same Pass", async () => {
    const html = await render({ error: "cancel_failed" });
    expect(text(html)).toContain("Cancel auto-renewal");
    expect(world.bound.filter((b) => b.action === "cancelAutoRenew").map((b) => b.args)).toContainEqual(["up1"]);
  });

  it("shows nothing about it without the parameter, and not for another error", async () => {
    expect(text(await render())).not.toContain("We could not cancel your renewal");
    expect(text(await render({ error: "payments_unavailable" }))).not.toContain("We could not cancel your renewal");
  });
});
