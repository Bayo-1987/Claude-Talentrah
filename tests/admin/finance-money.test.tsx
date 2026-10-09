/**
 * Finance money display: payment_transactions.amount is WHOLE NAIRA (the writers store the price in naira and the billing page prints it after a ₦), so the admin screens must not divide it by 100.
 * N5,000 in the table is a 5000 amount; an ad wallet of 12,000 shows N12,000.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const health = vi.hoisted(() => ({
  value: {
    payments: [{ status: "success", rail: "paystack", count: 1, totalAmount: 5000, currency: "NGN", oldestAt: "2026-10-01T10:00:00Z" }],
    pendingCount: 0, pendingRecent: 0, pendingCounted: 0, stalePending: 0, creditsByReason: [], passesByStatus: {}, passesAwaitingRenewalOutcome: 0, adWalletBalanceNgn: 12000, adWalletCount: 1,
  } as Record<string, unknown>,
}));
vi.mock("@/lib/admin/require-admin", () => ({ requirePermission: async () => ({ displayName: "Op", email: "op@example.test" }) }));
vi.mock("@/lib/admin/finance/queries", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/admin/finance/queries")>()), financialHealth: async () => health.value }));

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("the Finance page's money", async () => {
  const { default: Page } = await import("@/app/admin/(protected)/finance/page");
  const out = text(renderToStaticMarkup(await Page()));

  it("a payments row with amount 5000 shows N5,000, not N50", () => {
    expect(out).toContain("₦5,000");
    expect(out).not.toMatch(/₦50(?![,\d])/);
  });
  it("an ad wallet balance of 12,000 shows N12,000", () => {
    expect(out).toContain("₦12,000");
  });
});

describe("one converter for every admin Finance screen", async () => {
  const { formatWholeAmount } = await import("@/lib/admin/finance/money");
  const read = (rel: string) => readFileSync(path.join(__dirname, "../..", rel), "utf8");

  it("formats whole naira without converting it", () => {
    expect(formatWholeAmount(5000, "NGN")).toBe("₦5,000");
    expect(formatWholeAmount(2500, "NGN")).toBe("₦2,500");
    expect(formatWholeAmount(12000, "NGN")).toBe("₦12,000");
  });
  it("the Finance page and the person lookup both use it, and neither divides or multiplies by 100", () => {
    for (const rel of ["src/app/admin/(protected)/finance/page.tsx", "src/components/admin/person-lookup.tsx"]) {
      const src = read(rel);
      expect(src, rel).toContain('import { formatWholeAmount } from "@/lib/admin/finance/money"');
      expect(src, rel).not.toMatch(/\/ ?100\b|\* ?100\b/);
    }
  });
});
