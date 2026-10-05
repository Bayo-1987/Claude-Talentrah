/**
 * send-503 / S18 — the billing page lists EVERYTHING credits pay for, with the price read from CREDIT_COSTS.
 *
 * "Credits cover AI tailoring runs, cover letters, and premium templates" left out bullet rewrites, Farah messages, scholarship
 * checks, directory verification and boosts. The list is built from CREDIT_COSTS itself, through the same `priced()` helper every
 * spender button uses (send-493), so a new action cannot be added without a line here, and a repricing moves the page.
 */
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { priced } from "@/lib/credits/price-labels";
import { loadModule } from "../support/load-module";

interface Entry {
  key: string;
  label: string;
  cost: number;
  text: string;
}
interface Mod {
  creditPriceList?: () => Entry[];
}
const list = async () => {
  const m = await loadModule<Mod>("@/lib/credits/price-list");
  expect(m.creditPriceList, "creditPriceList must be exported from src/lib/credits/price-list.ts").toBeTypeOf("function");
  return m.creditPriceList!();
};

describe("creditPriceList", () => {
  it("has exactly one entry for every action in CREDIT_COSTS, none missing, none invented", async () => {
    const keys = (await list()).map((e) => e.key).sort();
    expect(keys).toEqual(Object.keys(CREDIT_COSTS).sort());
  });

  it("each line is the shared priced() text over the real cost", async () => {
    for (const e of await list()) {
      expect(e.cost, e.key).toBe(CREDIT_COSTS[e.key as keyof typeof CREDIT_COSTS]);
      expect(e.text, e.key).toBe(priced(e.label, e.cost));
    }
  });

  it("names the actions the old sentence left out", async () => {
    const labels = (await list()).map((e) => e.label.toLowerCase()).join(" | ");
    for (const word of ["bullet", "farah", "scholarship", "resume review", "boost", "auto-apply", "cover letter", "template"]) {
      expect(labels, word).toContain(word);
    }
  });

  it("says Resume, never CV", async () => {
    for (const e of await list()) expect(e.text, e.key).not.toMatch(/\bCVs?\b/);
  });
});
