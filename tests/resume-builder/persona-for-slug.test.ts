/**
 * The slug -> persona resolver (src/lib/resume-builder/persona-for-slug.ts)
 * in isolation, no database needed — the real end-to-end proof against a
 * live `resume_templates` row lives in create-resume-action.test.ts's
 * "seeds the persona matching the template's own slug" describe block. This
 * file is the fast, DB-free unit coverage for the resolver's own logic.
 *
 * RENAMED from persona-for-category.test.ts (and `personaForCategory` no
 * longer exists — see persona-for-slug.ts's own header for why it was
 * dropped rather than kept). The resolver is now keyed by literal template
 * `slug`, not `industry_category`, so every assertion below checks a slug
 * directly rather than a category string.
 */
import { describe, expect, it } from "vitest";
import { personaForSlug } from "@/lib/resume-builder/persona-for-slug";
import {
  PREVIEW_SAMPLE_RESUME,
  EPC_SITE_ENGINEER_RESUME,
  DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
  CONSTRUCTION_FOREMAN_RESUME,
  STRUCTURAL_DESIGN_ENGINEER_RESUME,
  ELECTRICAL_DESIGN_ENGINEER_RESUME,
  LAND_SURVEYOR_RESUME,
  GEOTECHNICAL_ENGINEER_RESUME,
  REAL_ESTATE_DEVELOPMENT_MANAGER_RESUME,
  DRILLING_RIG_SUPERVISOR_RESUME,
  OFFSHORE_PROCESS_ENGINEER_RESUME,
  WELLHEAD_COMPLETIONS_ENGINEER_RESUME,
} from "@/lib/resume-builder/preview-sample";
import { RESUME_TEMPLATES } from "@/lib/billing/catalog";

const ENGINEERING_GROUP_CATEGORIES = ["Engineering", "Construction & Real Estate", "Oil & Gas / Energy"];
const NGO_AGRICULTURE_CATEGORIES = ["NGO & Development", "Agriculture & Agribusiness"];

describe("personaForSlug", () => {
  it.each([
    ["blueprint", EPC_SITE_ENGINEER_RESUME],
    ["site-report", CONSTRUCTION_FOREMAN_RESUME],
    ["specification", STRUCTURAL_DESIGN_ENGINEER_RESUME],
    ["schematic", ELECTRICAL_DESIGN_ENGINEER_RESUME],
    ["site-plan", LAND_SURVEYOR_RESUME],
    ["foundation", GEOTECHNICAL_ENGINEER_RESUME],
    ["property-portfolio", REAL_ESTATE_DEVELOPMENT_MANAGER_RESUME],
    ["rig-report", DRILLING_RIG_SUPERVISOR_RESUME],
    ["offshore", OFFSHORE_PROCESS_ENGINEER_RESUME],
    ["wellhead", WELLHEAD_COMPLETIONS_ENGINEER_RESUME],
  ])("resolves Engineering-group slug %s to its own dedicated persona", (slug, persona) => {
    expect(personaForSlug(slug)).toBe(persona);
  });

  it.each(["field-mission", "impact-report", "grant-proposal", "harvest", "field-season", "value-chain"])(
    "resolves NGO/Agriculture slug %s to the (still shared, unchanged) development programme officer persona",
    (slug) => {
      expect(personaForSlug(slug)).toBe(DEVELOPMENT_PROGRAMME_OFFICER_RESUME);
    },
  );

  it("every other real catalog slug (outside the two groupings above) still falls back to PREVIEW_SAMPLE_RESUME", () => {
    const engineeringSlugs = new Set(
      RESUME_TEMPLATES.filter((t) => ENGINEERING_GROUP_CATEGORIES.includes(t.industry_category)).map((t) => t.slug),
    );
    const ngoSlugs = new Set(
      RESUME_TEMPLATES.filter((t) => NGO_AGRICULTURE_CATEGORIES.includes(t.industry_category)).map((t) => t.slug),
    );
    const remaining = RESUME_TEMPLATES.filter((t) => !engineeringSlugs.has(t.slug) && !ngoSlugs.has(t.slug));
    // Sanity: there really are slugs left to check — this pass claims ~53 of
    // 65 templates are untouched fallback, so this shouldn't be empty.
    expect(remaining.length).toBeGreaterThan(0);
    for (const template of remaining) {
      expect(personaForSlug(template.slug), `slug "${template.slug}"`).toBe(PREVIEW_SAMPLE_RESUME);
    }
  });

  it("falls back rather than crashing for an unknown or missing slug", () => {
    expect(personaForSlug("not-a-real-template")).toBe(PREVIEW_SAMPLE_RESUME);
    expect(personaForSlug(null)).toBe(PREVIEW_SAMPLE_RESUME);
    expect(personaForSlug(undefined)).toBe(PREVIEW_SAMPLE_RESUME);
  });

  it("the Engineering grouping's live slug list is exactly the 10 this pass split into individual personas (guards against catalog drift)", () => {
    const epcSlugs = RESUME_TEMPLATES.filter((t) => ENGINEERING_GROUP_CATEGORIES.includes(t.industry_category)).map(
      (t) => t.slug,
    );
    expect(epcSlugs.length).toBe(10);
    for (const slug of epcSlugs) {
      expect(personaForSlug(slug), `slug "${slug}"`).not.toBe(PREVIEW_SAMPLE_RESUME);
    }
  });

  it("every NGO/Agriculture-persona-eligible slug in the real catalog actually resolves to the development programme officer persona (guards against the map and the catalog drifting apart)", () => {
    const slugs = RESUME_TEMPLATES.filter((t) => NGO_AGRICULTURE_CATEGORIES.includes(t.industry_category)).map(
      (t) => t.slug,
    );
    expect(slugs.length).toBe(6);
    for (const slug of slugs) {
      expect(personaForSlug(slug), `slug "${slug}"`).toBe(DEVELOPMENT_PROGRAMME_OFFICER_RESUME);
    }
  });
});
