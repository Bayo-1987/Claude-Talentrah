/**
 * The category/slug -> persona resolver (src/lib/resume-builder/
 * persona-for-category.ts) in isolation, no database needed — the real
 * end-to-end proof against a live `resume_templates` row lives in
 * create-resume-action.test.ts's "seeds the persona matching the template's
 * category" describe block. This file is the fast, DB-free unit coverage for
 * the resolver's own logic: exact category matches, and the fallback for
 * everything else.
 */
import { describe, expect, it } from "vitest";
import { personaForCategory, personaForSlug } from "@/lib/resume-builder/persona-for-category";
import {
  PREVIEW_SAMPLE_RESUME,
  EPC_SITE_ENGINEER_RESUME,
  DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
} from "@/lib/resume-builder/preview-sample";
import { RESUME_TEMPLATES } from "@/lib/billing/catalog";

describe("personaForCategory", () => {
  it.each([
    ["Engineering", EPC_SITE_ENGINEER_RESUME],
    ["Construction & Real Estate", EPC_SITE_ENGINEER_RESUME],
    ["Oil & Gas / Energy", EPC_SITE_ENGINEER_RESUME],
    ["NGO & Development", DEVELOPMENT_PROGRAMME_OFFICER_RESUME],
    ["Agriculture & Agribusiness", DEVELOPMENT_PROGRAMME_OFFICER_RESUME],
  ])("resolves %s to its dedicated persona", (category, persona) => {
    expect(personaForCategory(category)).toBe(persona);
  });

  it.each([
    "Business",
    "Project Management",
    "Administration",
    "Customer Success",
    "Technology",
    "Design",
    "Banking & Finance",
    "Sales & Marketing",
    "Healthcare",
    "Legal",
    "Government & Public Sector",
    "Education & Academia",
    "Creative & Media",
    "Hospitality & Travel",
    "Telecommunications",
    "Logistics & Supply Chain",
    "Some Category That Does Not Exist",
  ])("falls back to PREVIEW_SAMPLE_RESUME for %s, a category with no dedicated persona", (category) => {
    expect(personaForCategory(category)).toBe(PREVIEW_SAMPLE_RESUME);
  });

  it("falls back for null/undefined rather than throwing", () => {
    expect(personaForCategory(null)).toBe(PREVIEW_SAMPLE_RESUME);
    expect(personaForCategory(undefined)).toBe(PREVIEW_SAMPLE_RESUME);
  });
});

describe("personaForSlug", () => {
  it("resolves a real Engineering-grouping slug to the EPC engineer persona", () => {
    expect(personaForSlug("blueprint")).toBe(EPC_SITE_ENGINEER_RESUME);
    expect(personaForSlug("site-report")).toBe(EPC_SITE_ENGINEER_RESUME);
    expect(personaForSlug("rig-report")).toBe(EPC_SITE_ENGINEER_RESUME);
    expect(personaForSlug("site-plan")).toBe(EPC_SITE_ENGINEER_RESUME);
  });

  it("resolves a real NGO & Development / Agriculture slug to the development programme officer persona", () => {
    expect(personaForSlug("field-mission")).toBe(DEVELOPMENT_PROGRAMME_OFFICER_RESUME);
    expect(personaForSlug("harvest")).toBe(DEVELOPMENT_PROGRAMME_OFFICER_RESUME);
  });

  it("resolves a slug with no dedicated persona to the fallback", () => {
    expect(personaForSlug("clean-professional")).toBe(PREVIEW_SAMPLE_RESUME);
    expect(personaForSlug("product-tech")).toBe(PREVIEW_SAMPLE_RESUME);
  });

  it("falls back rather than crashing for an unknown or missing slug", () => {
    expect(personaForSlug("not-a-real-template")).toBe(PREVIEW_SAMPLE_RESUME);
    expect(personaForSlug(null)).toBe(PREVIEW_SAMPLE_RESUME);
    expect(personaForSlug(undefined)).toBe(PREVIEW_SAMPLE_RESUME);
  });

  it("every EPC-persona-eligible slug in the real catalog actually resolves to that persona (guards against the map and the catalog drifting apart)", () => {
    const epcCategories = ["Engineering", "Construction & Real Estate", "Oil & Gas / Energy"];
    const epcSlugs = RESUME_TEMPLATES.filter((t) => epcCategories.includes(t.industry_category)).map(
      (t) => t.slug,
    );
    expect(epcSlugs.length).toBe(10);
    for (const slug of epcSlugs) {
      expect(personaForSlug(slug), `slug "${slug}"`).toBe(EPC_SITE_ENGINEER_RESUME);
    }
  });

  it("every NGO/Agriculture-persona-eligible slug in the real catalog actually resolves to that persona", () => {
    const categories = ["NGO & Development", "Agriculture & Agribusiness"];
    const slugs = RESUME_TEMPLATES.filter((t) => categories.includes(t.industry_category)).map((t) => t.slug);
    expect(slugs.length).toBe(6);
    for (const slug of slugs) {
      expect(personaForSlug(slug), `slug "${slug}"`).toBe(DEVELOPMENT_PROGRAMME_OFFICER_RESUME);
    }
  });
});
