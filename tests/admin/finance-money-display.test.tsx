/**
 * FIN-MONEY-1. payment_transactions.amount is WHOLE NAIRA (a ₦5,000 payment is stored as 5000). The Finance page used to divide every payment total by 100, so ₦5,000 showed as ₦50, while the
 * ad-wallet balance (also whole naira) was multiplied by 100 first and showed correctly. Every money figure on the page now goes through ONE formatter that takes whole units.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const health = vi.hoisted(() => ({
  value: {
    payments: [
      { status: "success", rail: "card", count: 2, totalAmount: 5000, currency: "NGN", oldestAt: "2026-10-01T10:00:00Z" },
      { status: "pending", rail: "mobile_money", count: 1, totalAmount: 2500, currency: "NGN", oldestAt: "2026-10-02T10:00:00Z" },
      { status: "failed", rail: "card", count: 1, totalAmount: 13000, currency: "NGN", oldestAt: "2026-10-03T10:00:00Z" },
    ],
    pendingCount: 0, pendingRecent: 0, pendingCounted: 0, stalePending: 0, creditsByReason: [], passesByStatus: {}, passesAwaitingRenewalOutcome: 0, adWalletBalanceNgn: 12000, adWalletCount: 1,
  } as Record<string, unknown>,
}));
vi.mock("@/lib/admin/require-admin", () => ({ requirePermission: async () => ({ displayName: "Op", email: "op@example.test" }) }));
vi.mock("@/lib/admin/finance/queries", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/admin/finance/queries")>()), financialHealth: async () => health.value }));

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("Finance page money figures", async () => {
  const { default: Page } = await import("@/app/admin/(protected)/finance/page");
  const out = text(renderToStaticMarkup(await Page()));

  it("shows each payment bucket's total in whole naira (a total of 5000 is ₦5,000, not ₦50)", () => {
    expect(out).toContain("₦5,000");
    expect(out).toContain("₦2,500");
    expect(out).toContain("₦13,000");
    expect(out).not.toMatch(/₦50(?![,\d])/);
    expect(out).not.toMatch(/₦25(?![,\d])/);
    expect(out).not.toMatch(/₦130(?![,\d])/);
  });

  it("shows the ad-wallet balance of 12000 naira as ₦12,000, through the same converter", () => {
    expect(out).toContain("₦12,000");
    expect(out).not.toContain("₦1,200,000");
  });
});
