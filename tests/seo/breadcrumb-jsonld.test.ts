/**
 * send-509 / S3-21c (P10) — BreadcrumbList structured data on the scholarship pages, and nothing else.
 *
 * The owner's call: BreadcrumbList ONLY. Google's structured-data gallery has no scholarship rich result (checked 2026-09-01 and recorded in
 * docs/scholarship-sources.md), and schema.org's MonetaryGrant is a core type with no deadline property, so nothing would be claimed
 * that a crawler could not stand behind. Breadcrumb IS a supported rich result.
 *
 * Pinned here: the builder's output shape (what Google's Breadcrumb documentation requires: itemListElement of ListItem with position and
 * name, and item as an absolute URL), its refusals (null rather than markup it cannot stand behind), and that each scholarship page renders
 * exactly one block, built through the builder. e2e/public-scholarship-page.spec.ts validates the real rendered pages.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";

interface Mod {
  buildBreadcrumbJsonLd?: (trail: Array<{ name: string; path: string }>) => Record<string, unknown> | null;
}
const build = async (trail: Array<{ name: string; path: string }>) => {
  const m = await loadModule<Mod>("@/lib/seo/breadcrumb-jsonld");
  expect(m.buildBreadcrumbJsonLd, "buildBreadcrumbJsonLd must be exported from src/lib/seo/breadcrumb-jsonld.ts").toBeTypeOf("function");
  return m.buildBreadcrumbJsonLd!(trail);
};

const TRAIL = [
  { name: "Talentrah", path: "/" },
  { name: "Scholarships", path: "/scholarships" },
  { name: "Chevening Scholarships", path: "/scholarships/df5233e0-8963-4f84-b983-a76bd3f247f0" },
];

describe("buildBreadcrumbJsonLd", () => {
  it("is a schema.org BreadcrumbList of positioned ListItems", async () => {
    const out = (await build(TRAIL))!;
    expect(out["@context"]).toBe("https://schema.org");
    expect(out["@type"]).toBe("BreadcrumbList");
    const items = out.itemListElement as Array<Record<string, unknown>>;
    expect(items.map((i) => i["@type"])).toEqual(["ListItem", "ListItem", "ListItem"]);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items.map((i) => i.name)).toEqual(["Talentrah", "Scholarships", "Chevening Scholarships"]);
  });

  it("every item is an ABSOLUTE https URL on the site's own origin", async () => {
    const items = ((await build(TRAIL))!.itemListElement as Array<{ item: string }>).map((i) => i.item);
    for (const url of items) expect(url).toMatch(/^https?:\/\/[^/]+\//);
    expect(items[0]).toMatch(/^https?:\/\/[^/]+\/$/);
    expect(items[1]).toMatch(/\/scholarships$/);
    expect(items[2]).toMatch(/\/scholarships\/df5233e0-8963-4f84-b983-a76bd3f247f0$/);
    expect(new Set(items.map((u) => new URL(u).origin)).size, "one origin").toBe(1);
  });

  it("emits ONLY BreadcrumbList: no scholarship, grant, course or article claims", async () => {
    const json = JSON.stringify(await build(TRAIL));
    for (const type of ["MonetaryGrant", "Grant", "Course", "Article", "EducationalOccupationalProgram", "Offer", "JobPosting"]) {
      expect(json, type).not.toContain(`"${type}"`);
    }
  });

  it("refuses (null) rather than emit markup it cannot stand behind", async () => {
    expect(await build([])).toBeNull();
    expect(await build([{ name: "Talentrah", path: "/" }]), "one crumb is not a trail").toBeNull();
    expect(await build([{ name: "Talentrah", path: "/" }, { name: "  ", path: "/scholarships" }])).toBeNull();
    expect(await build([{ name: "Talentrah", path: "/" }, { name: "Scholarships", path: "scholarships" }]), "a relative path").toBeNull();
  });
});

describe("each scholarship page renders exactly one breadcrumb block, built by the builder", () => {
  const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
  const PAGES: Array<[string, string]> = [
    ["the detail page", "src/app/(app)/scholarships/[id]/page.tsx"],
    ["fully funded", "src/app/(app)/scholarships/fully-funded/page.tsx"],
    ["by degree level", "src/app/(app)/scholarships/degree/[level]/page.tsx"],
    ["apply now", "src/app/(app)/scholarships/apply-now/page.tsx"],
  ];
  it.each(PAGES)("%s", (_name, path) => {
    const src = read(path);
    expect(src).toMatch(/from "@\/lib\/seo\/breadcrumb-jsonld"/);
    expect(src).toMatch(/from "@\/components\/seo\/json-ld"/);
    expect(src.match(/<JsonLd\b/g)?.length, "exactly one JsonLd block").toBe(1);
    expect(src).toMatch(/buildBreadcrumbJsonLd\(/);
  });
});
