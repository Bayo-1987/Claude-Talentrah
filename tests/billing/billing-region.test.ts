/**
 * send-503 / S18 — Settings names the billing region, and the words match the real billing path.
 *
 * Settings said "Billing region: Home market" and "It decides how you're billed". Read the code: initiatePurchaseAction never
 * reads market_segment. Every purchase, from every account, is created in NGN and sent to Paystack. So the honest copy is
 * country-based and says "billed in naira (₦)"; outside Nigeria that realistically means a card:
 *   Nigeria            -> "Nigeria — billed in naira (₦)"
 *   anywhere else      -> "Outside Nigeria — billed in naira (₦) by card"
 * The source test below is what ties the words to the code: if a USD/Stripe or segment-dependent path is ever added to
 * initiatePurchaseAction, it fails and the copy has to be revisited deliberately.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";

interface Mod {
  BILLING_CURRENCY?: string;
  billingRegionLabel?: (country: string | null | undefined) => string;
}
const mod = () => loadModule<Mod>("@/lib/billing/region");

describe("billingRegionLabel", () => {
  it("Nigeria", async () => {
    const m = await mod();
    expect(m.billingRegionLabel?.("Nigeria")).toBe("Nigeria — billed in naira (₦)");
  });

  it("every other country, including the rest of Africa and the diaspora", async () => {
    const m = await mod();
    for (const country of ["United Kingdom", "United States", "Canada", "Ghana", "Kenya", "South Africa", "Other"]) {
      expect(m.billingRegionLabel?.(country), country).toBe("Outside Nigeria — billed in naira (₦) by card");
    }
  });

  it("an unknown country gets the honest, country-free statement rather than a guess", async () => {
    const m = await mod();
    expect(m.billingRegionLabel?.(null)).toBe("Billed in naira (₦)");
    expect(m.billingRegionLabel?.("")).toBe("Billed in naira (₦)");
  });
});

describe("the copy is tied to the real billing path", () => {
  const actions = readFileSync(join(__dirname, "../../src/lib/billing/actions.ts"), "utf8");

  it("the currency the copy names is the one initiatePurchaseAction actually charges", async () => {
    const m = await mod();
    expect(m.BILLING_CURRENCY).toBe("NGN");
    expect(actions).toMatch(/currency:\s*BILLING_CURRENCY/);
    expect(actions).not.toMatch(/currency:\s*["']/);
  });

  it("initiatePurchaseAction does not branch on the market segment or use another processor or currency", () => {
    expect(actions).not.toMatch(/market_segment|marketSegment/);
    expect(actions).not.toMatch(/stripe/i);
    expect(actions).not.toMatch(/\bUSD\b|\bGBP\b/);
  });

  it("Settings no longer claims the segment 'decides how you're billed'", () => {
    const page = readFileSync(join(__dirname, "../../src/app/(app)/settings/page.tsx"), "utf8");
    expect(page).not.toMatch(/It decides how you're billed/);
    expect(page).not.toMatch(/Home market/);
    expect(page).toMatch(/billingRegionLabel/);
  });
});
