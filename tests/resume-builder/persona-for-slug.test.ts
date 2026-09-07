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
 *
 * UPDATED for batch 2: `field-mission` still resolves to the shared
 * development-programme-officer persona, but the other 5 NGO & Development /
 * Agriculture & Agribusiness slugs each now resolve to their OWN new
 * persona (per-slug assertions below, not just "not the fallback") — the
 * grouping is fully split as of this pass, same as Engineering was in batch
 * 1. Five standalone-category slugs (one each from Technology, Banking &
 * Finance, Healthcare, Legal, Business) also moved off the fallback; the
 * "everything else still falls back" check now excludes those 5 slugs too,
 * by literal slug rather than by category, since each of those 5 categories
 * still has OTHER slugs deliberately left on the fallback.
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
  IMPACT_REPORTING_OFFICER_RESUME,
  GRANTS_PROPOSAL_OFFICER_RESUME,
  COMMERCIAL_AGRONOMIST_RESUME,
  FIELD_PRODUCTION_SUPERVISOR_RESUME,
  VALUE_CHAIN_ANALYST_RESUME,
  SOFTWARE_ENGINEER_RESUME,
  CREDIT_RISK_ANALYST_RESUME,
  REGISTERED_NURSE_RESUME,
  CORPORATE_LEGAL_ASSOCIATE_RESUME,
  BUSINESS_OPERATIONS_MANAGER_RESUME,
} from "@/lib/resume-builder/preview-sample";
import { RESUME_TEMPLATES } from "@/lib/billing/catalog";

const ENGINEERING_GROUP_CATEGORIES = ["Engineering", "Construction & Real Estate", "Oil & Gas / Energy"];
const NGO_AGRICULTURE_CATEGORIES = ["NGO & Development", "Agriculture & Agribusiness"];
// The 5 standalone-category slugs batch 2 gave a dedicated persona to — one
// each from 5 different categories, deliberately NOT the whole category
// (e.g. `terminal`/`stack-trace` are still Technology slugs on the fallback).
const STANDALONE_BATCH_2_SLUGS = ["product-tech", "ledger", "care-plan", "chambers", "business-memo"];

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

  it("resolves field-mission to the (still shared, unchanged) development programme officer persona", () => {
    expect(personaForSlug("field-mission")).toBe(DEVELOPMENT_PROGRAMME_OFFICER_RESUME);
  });

  it.each([
    ["impact-report", IMPACT_REPORTING_OFFICER_RESUME],
    ["grant-proposal", GRANTS_PROPOSAL_OFFICER_RESUME],
    ["harvest", COMMERCIAL_AGRONOMIST_RESUME],
    ["field-season", FIELD_PRODUCTION_SUPERVISOR_RESUME],
    ["value-chain", VALUE_CHAIN_ANALYST_RESUME],
  ])("resolves batch-2-split NGO/Agriculture slug %s to its own dedicated persona, not field-mission's", (slug, persona) => {
    expect(personaForSlug(slug)).toBe(persona);
    expect(personaForSlug(slug)).not.toBe(DEVELOPMENT_PROGRAMME_OFFICER_RESUME);
  });

  it.each([
    ["product-tech", SOFTWARE_ENGINEER_RESUME],
    ["ledger", CREDIT_RISK_ANALYST_RESUME],
    ["care-plan", REGISTERED_NURSE_RESUME],
    ["chambers", CORPORATE_LEGAL_ASSOCIATE_RESUME],
    ["business-memo", BUSINESS_OPERATIONS_MANAGER_RESUME],
  ])("resolves batch-2 standalone-category slug %s to its own dedicated persona", (slug, persona) => {
    expect(personaForSlug(slug)).toBe(persona);
    expect(personaForSlug(slug)).not.toBe(PREVIEW_SAMPLE_RESUME);
  });

  it("every other real catalog slug (outside both groupings and the 5 standalone slugs above) still falls back to PREVIEW_SAMPLE_RESUME", () => {
    const engineeringSlugs = new Set(
      RESUME_TEMPLATES.filter((t) => ENGINEERING_GROUP_CATEGORIES.includes(t.industry_category)).map((t) => t.slug),
    );
    const ngoSlugs = new Set(
      RESUME_TEMPLATES.filter((t) => NGO_AGRICULTURE_CATEGORIES.includes(t.industry_category)).map((t) => t.slug),
    );
    const standaloneSlugs = new Set(STANDALONE_BATCH_2_SLUGS);
    const remaining = RESUME_TEMPLATES.filter(
      (t) => !engineeringSlugs.has(t.slug) && !ngoSlugs.has(t.slug) && !standaloneSlugs.has(t.slug),
    );
    // Sanity: there really are slugs left to check — this shouldn't be empty.
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

  it("the Engineering grouping's live slug list is exactly the 10 batch 1 split into individual personas (guards against catalog drift)", () => {
    const epcSlugs = RESUME_TEMPLATES.filter((t) => ENGINEERING_GROUP_CATEGORIES.includes(t.industry_category)).map(
      (t) => t.slug,
    );
    expect(epcSlugs.length).toBe(10);
    for (const slug of epcSlugs) {
      expect(personaForSlug(slug), `slug "${slug}"`).not.toBe(PREVIEW_SAMPLE_RESUME);
    }
  });

  it("the NGO/Agriculture grouping's live slug list is exactly the 6 this batch finished splitting (guards against catalog drift)", () => {
    const slugs = RESUME_TEMPLATES.filter((t) => NGO_AGRICULTURE_CATEGORIES.includes(t.industry_category)).map(
      (t) => t.slug,
    );
    expect(slugs.length).toBe(6);
    for (const slug of slugs) {
      expect(personaForSlug(slug), `slug "${slug}"`).not.toBe(PREVIEW_SAMPLE_RESUME);
    }
    // field-mission specifically is the one that stayed on the shared persona.
    expect(personaForSlug("field-mission")).toBe(DEVELOPMENT_PROGRAMME_OFFICER_RESUME);
    for (const slug of slugs.filter((s) => s !== "field-mission")) {
      expect(personaForSlug(slug), `slug "${slug}"`).not.toBe(DEVELOPMENT_PROGRAMME_OFFICER_RESUME);
    }
  });
});
