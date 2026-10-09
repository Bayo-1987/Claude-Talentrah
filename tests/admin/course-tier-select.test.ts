/**
 * COURSE-TIER-1 (QA, P2, a regression from #885): after a successful Save of a changed price tier the select showed the OLD tier, and the next Save (even of a title typo) wrote the old tier back.
 *
 * Why: a <select> takes its `defaultValue` only when it MOUNTS; React ignores a later change to it. #885 keyed the select by the typed value of a refused save (so a refused save's choice shows), which made
 * it remount whenever that key changed, and on the render where the key changed the default still came from the course as it was BEFORE the revalidated row arrived. A key and a default that are computed
 * from different moments can disagree. They now come from one function, `tierSelect`, from the same two inputs: the saved tier (a prop) and the typed values of a refused save. Whenever the default changes,
 * the key changes with it (so the select remounts with the new default), and whenever the key is unchanged the default is too (so it is never remounted onto a stale one).
 * Browser proof: QA's e2e/admin-courses-form-rule.spec.ts (COURSE-TIER-1).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tierSelect } from "@/lib/admin/catalog/tier-select";

const TIERS = ["free", "low", "mid", "high"];
const TYPED = [undefined, { price_tier: "free" }, { price_tier: "low" }, { price_tier: "mid" }, { price_tier: "high" }] as const;

describe("tierSelect: the key and the default come from the same inputs", () => {
  it("nothing typed: the default is the saved tier", () => {
    expect(tierSelect("mid", undefined).defaultValue).toBe("mid");
  });
  it("a refused save: the default is what was typed, not the saved tier", () => {
    expect(tierSelect("low", { price_tier: "high" }).defaultValue).toBe("high");
  });
  it("the QA probe: Save with tier mid succeeds, the row arrives with mid, the select shows mid", () => {
    const before = tierSelect("free", undefined); // the row as it was
    const after = tierSelect("mid", undefined); // the revalidated row, no typed values after a success
    expect(after.defaultValue).toBe("mid");
    expect(after.key, "the default changed, so the select remounts to show it").not.toBe(before.key);
  });
  it("a refused save followed by a successful one ends on the saved tier, remounted", () => {
    const refused = tierSelect("free", { price_tier: "mid" });
    const success = tierSelect("mid", undefined);
    expect(refused.defaultValue).toBe("mid");
    expect(success.defaultValue).toBe("mid");
  });
  it("for every combination: two renders with the same key have the same default (never a stale one under an unchanged key)", () => {
    const seen = new Map<string, string>();
    for (const saved of TIERS) {
      for (const typed of TYPED) {
        const { key, defaultValue } = tierSelect(saved, typed);
        if (seen.has(key)) expect(defaultValue, `${key} was used for two different defaults`).toBe(seen.get(key));
        seen.set(key, defaultValue);
      }
    }
    expect(seen.size).toBeGreaterThan(8);
  });
});

describe("the row form", () => {
  const form = readFileSync(path.join(__dirname, "../../src/components/admin/course-row-form.tsx"), "utf8").replace(/\s+/g, " ");
  it("the price tier select takes its key and default from tierSelect, nothing else", () => {
    expect(form).toContain("tierSelect(course.priceTier, state.values)");
    expect(form).toContain("key={tier.key}");
    expect(form).toContain("defaultValue={tier.defaultValue}");
    expect(form).not.toContain('selectKey(state.values, "price_tier")');
  });
});
