/**
 * Owner, 9 Oct: a premium resume template must never be saved with an unlock cost of 0, a negative cost or no cost. Templates are written from ONE place, RESUME_TEMPLATES in src/lib/billing/catalog.ts,
 * by two seeders (scripts/seed-catalog.ts, scripts/seed.ts); no admin screen creates or edits them. So the validation lives next to the definitions, runs over the catalog in this test, and runs in both
 * seeders BEFORE anything is written. Existing rows are not touched (the owner decides about any already in the database).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RESUME_TEMPLATES, assertValidTemplateDefinitions, templateDefinitionProblems, type ResumeTemplateDefinition } from "@/lib/billing/catalog";

const base: ResumeTemplateDefinition = {
  name: "T", slug: "t", industry_category: "Business", is_premium: true, unlock_cost_credits: 10, ats_safe: true, structure_schema: {},
};
const t = (over: Partial<ResumeTemplateDefinition>): ResumeTemplateDefinition => ({ ...base, ...over });

describe("templateDefinitionProblems", () => {
  it("a premium template with a real cost is fine", () => {
    expect(templateDefinitionProblems(t({ is_premium: true, unlock_cost_credits: 10 }))).toEqual([]);
    expect(templateDefinitionProblems(t({ is_premium: true, unlock_cost_credits: 1 }))).toEqual([]);
  });
  it("a free template is not premium and costs 0", () => {
    expect(templateDefinitionProblems(t({ is_premium: false, unlock_cost_credits: 0 }))).toEqual([]);
  });
  it.each([0, -1, -10, 0.5, 2.5, Number.NaN, Number.POSITIVE_INFINITY])("a premium template with cost %s is refused", (cost) => {
    const p = templateDefinitionProblems(t({ is_premium: true, unlock_cost_credits: cost }));
    expect(p.length).toBeGreaterThan(0);
    expect(p.join(" ")).toMatch(/premium/i);
  });
  it("a premium template with no cost at all (null or undefined) is refused", () => {
    expect(templateDefinitionProblems(t({ unlock_cost_credits: null as unknown as number })).length).toBeGreaterThan(0);
    expect(templateDefinitionProblems(t({ unlock_cost_credits: undefined as unknown as number })).length).toBeGreaterThan(0);
  });
  it("a template that charges but is not premium is refused (it would be saved as free, or priced without being premium)", () => {
    const p = templateDefinitionProblems(t({ is_premium: false, unlock_cost_credits: 10 }));
    expect(p.join(" ")).toMatch(/not premium|free/i);
  });
});

describe("assertValidTemplateDefinitions", () => {
  it("names every offender by slug, in one error", () => {
    expect(() => assertValidTemplateDefinitions([t({ slug: "good" }), t({ slug: "bad-zero", unlock_cost_credits: 0 }), t({ slug: "bad-neg", unlock_cost_credits: -3 })])).toThrow(/bad-zero[\s\S]*bad-neg/);
  });
  it("passes a clean list", () => {
    expect(() => assertValidTemplateDefinitions([t({ slug: "a" }), t({ slug: "b", is_premium: false, unlock_cost_credits: 0 })])).not.toThrow();
  });
  it("rejects a duplicate slug (the seeders upsert on slug, so a duplicate silently overwrites)", () => {
    expect(() => assertValidTemplateDefinitions([t({ slug: "same" }), t({ slug: "same" })])).toThrow(/same/);
  });
});

describe("the real catalog", () => {
  it("every template in RESUME_TEMPLATES is valid today", () => {
    expect(() => assertValidTemplateDefinitions(RESUME_TEMPLATES)).not.toThrow();
  });
});

describe("both writers validate before they write", () => {
  const flat = (rel: string) => readFileSync(path.join(__dirname, "../..", rel), "utf8").replace(/\s+/g, " ");
  it("scripts/seed-catalog.ts", () => {
    const s = flat("scripts/seed-catalog.ts");
    expect(s).toContain("assertValidTemplateDefinitions(RESUME_TEMPLATES)");
    expect(s.indexOf("assertValidTemplateDefinitions(RESUME_TEMPLATES)")).toBeLessThan(s.indexOf('.from("resume_templates")'));
  });
  it("scripts/seed.ts", () => {
    const s = flat("scripts/seed.ts");
    expect(s).toContain("assertValidTemplateDefinitions(RESUME_TEMPLATES)");
    expect(s.indexOf("assertValidTemplateDefinitions(RESUME_TEMPLATES)")).toBeLessThan(s.indexOf('.from("resume_templates")'));
  });
});
