/**
 * send-503 / S18 — what the billing page says, rendered and pinned.
 *
 *   - the credits blurb lists everything credits pay for, with costs from CREDIT_COSTS (not the old three-item sentence)
 *   - "Resume", never "CV"
 *   - prices are one text node ("₦2,500"), in packs, passes and receipts
 *   - a receipt shows the short number ("CP-678586C1") and keeps the full Paystack reference under "Payment reference"
 *
 * Server component rendered with a fake Supabase client that returns fixed rows per table.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { priced } from "@/lib/credits/price-labels";

const tables = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]> }));
vi.mock("@/lib/auth/require-user", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/require-user")>()),
  requireUser: async () => ({ profile: { id: "u1", credits_balance: 12, country: "Nigeria" }, user: { id: "u1" } }),
}));
vi.mock("@/lib/billing/actions", () => ({ initiatePurchaseAction: async () => {}, cancelAutoRenewAction: async () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const chain: Record<string, unknown> = new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ data: tables.rows[table] ?? [], error: null });
            return () => chain;
          },
        },
      );
      return chain;
    },
  }),
}));

import BillingPage from "@/app/(app)/billing/page";

const UUID = "678586c1-9f2e-4c3a-8d11-0a1b2c3d4e5f";
const REF = `credit_pack_${UUID}`;

beforeEach(() => {
  tables.rows = {
    credit_packs: [
      { id: "p1", name: "Starter", credits: 20, price_ngn: 2500 },
      { id: "p2", name: "Plus", credits: 50, price_ngn: 5000 },
    ],
    passes: [{ id: "s1", name: "7-Day Sprint Pass", duration_days: 7, price_ngn: 6500 }],
    user_passes: [],
    payment_transactions: [
      { id: "t1", amount: 2500, currency: "NGN", product_type: "credit_pack", rail: "paystack", channel: "card", paystack_reference: REF, created_at: "2026-10-01T10:00:00.000Z" },
    ],
  };
});

const render = async (searchParams: { purchased?: string; error?: string } = {}) =>
  renderToString(await BillingPage({ searchParams: Promise.resolve(searchParams) }));
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("the credits blurb", () => {
  it("lists every action credits pay for, each with its cost from CREDIT_COSTS", async () => {
    const t = text(await render());
    for (const [label, cost] of [
      ["Tailor a resume", CREDIT_COSTS.tailoringRun],
      ["Cover letter", CREDIT_COSTS.coverLetterRun],
      ["Bullet rewrite", CREDIT_COSTS.bulletRewrite],
      ["Farah message", CREDIT_COSTS.farahChatMessage],
      ["Scholarship eligibility check", CREDIT_COSTS.scholarshipEligibilityCheck],
    ] as const) {
      expect(t, label).toContain(priced(label, cost));
    }
  });

  it("no longer uses the old three-item sentence", async () => {
    expect(text(await render())).not.toContain("Credits cover AI tailoring runs, cover letters, and premium templates");
  });
});

describe("house wording", () => {
  it("says Resume, never CV, anywhere on the page", async () => {
    const t = text(await render());
    expect(t).toContain("1 resume tailoring");
    expect(t).not.toMatch(/\bCVs?\b/);
  });
});

describe("prices are one text node", () => {
  it("pack and pass prices read ₦2,500 / ₦5,000 / ₦6,500 contiguous in the markup", async () => {
    const html = await render();
    for (const p of ["₦2,500", "₦5,000", "₦6,500"]) expect(html, p).toContain(`>${p}<`);
    expect(html).not.toMatch(/₦<\/span>/);
    expect(html).not.toMatch(/₦<!-- -->/);
  });

  it("the receipt amounts too", async () => {
    const html = await render({ purchased: "1" });
    expect(html.match(/>₦2,500</g)?.length ?? 0).toBeGreaterThanOrEqual(2); // pack price, banner, history row
    expect(html).not.toMatch(/₦<!-- -->/);
  });
});

describe("receipts", () => {
  it("history and banner show the short number", async () => {
    const t = text(await render({ purchased: "1" }));
    expect(t).toContain("Receipt CP-678586C1");
  });

  it("the long internal reference is not shown as the receipt, but is kept under 'Payment reference'", async () => {
    const html = await render({ purchased: "1" });
    expect(text(html)).not.toContain(`Receipt ${REF}`);
    expect(html).toMatch(/Payment reference[\s\S]{0,400}credit_pack_678586c1-9f2e-4c3a-8d11-0a1b2c3d4e5f/);
  });
});
