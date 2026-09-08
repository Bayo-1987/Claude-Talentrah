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
 *
 * UPDATED for batch 3A: 14 more slugs across 5 categories now resolve to
 * their own persona, and — unlike batch 2's standalone slugs — every one of
 * these 5 categories (Administration, Business, Technology, Sales &
 * Marketing, Education & Academia) is now FULLY split, not just one slug
 * each. That includes `terminal` and `stack-trace`, which batch 2's own
 * comment explicitly called out as staying on the fallback "for now" — they
 * don't anymore, so the drift-guard tests below assert full-category
 * coverage for these 5, the same style batch 1 used for the Engineering
 * grouping, rather than a standalone-slug list.
 *
 * UPDATED for batch 3B: 15 more slugs now resolve to their own persona, and
 * EVERY ONE of batch 2's three remaining standalone categories (Banking &
 * Finance, Healthcare, Legal) is now fully split too — `ledger`, `care-plan`
 * and `chambers` were each the one mapped slug in a 3-slug category; their
 * two siblings apiece (`balance-sheet`/`compliance-brief`,
 * `clinical`/`rounds`, `legal-brief`/`statute`) are now mapped by this
 * batch, so `STANDALONE_BATCH_2_SLUGS` below is retired from the "everything
 * else falls back" aggregator (though its own per-slug test stays — those 5
 * slugs still each resolve correctly) in favour of folding all 3 categories
 * into a full-category exclusion, the same style as `BATCH_3A_FULL_
 * CATEGORIES`. Three brand-new categories (Government & Public Sector,
 * Project Management, Logistics & Supply Chain) are also fully split as of
 * this batch — see `BATCH_3B_FULL_CATEGORIES` below.
 *
 * UPDATED for batch 3C (THIRD AND FINAL batch closing the 44 fallback slugs
 * batches 3A/3B left standing): the last 15 slugs now resolve to their own
 * persona, across 5 more brand-new categories fully split in one pass —
 * Creative & Media, Customer Success, Design, Hospitality & Travel and
 * Telecommunications (see `BATCH_3C_FULL_CATEGORIES` below). THIS CLOSES THE
 * LAST GAP: every one of the catalog's 65 slugs now resolves to a dedicated
 * persona. The old "every OTHER real catalog slug still falls back" test
 * (which asserted `remaining.length` was greater than zero, i.e. that some
 * slugs were still deliberately left unmapped) is RETIRED — after this
 * batch there is nothing left for it to assert, and a test that can never
 * find a "remaining" slug again is not a regression guard, it's dead code.
 * It is replaced by a single definitive regression test — "every catalog
 * slug in RESUME_TEMPLATES resolves to a dedicated persona, not the
 * PREVIEW_SAMPLE_RESUME fallback" — that iterates the ENTIRE live catalog
 * (not a computed "remaining" subset) and is exactly the kind of check that
 * would have caught the original `structured-admin` gap by hand before
 * send-75 had to point it out; it now stays as a permanent guard against a
 * newly-added template slug quietly landing on the fallback again. The
 * "falls back rather than crashing for an unknown or missing slug" test
 * keeps proving the fallback mechanism itself still works, using a slug that
 * is deliberately fake rather than a real catalog one, since no real catalog
 * slug can demonstrate that anymore.
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
  EXECUTIVE_ADMINISTRATIVE_ASSISTANT_RESUME,
  FRONT_OFFICE_MANAGER_RESUME,
  RECORDS_DOCUMENTATION_OFFICER_RESUME,
  BUSINESS_GENERALIST_RESUME,
  CHIEF_OPERATING_OFFICER_RESUME,
  MICROBIOLOGY_LECTURER_RESUME,
  ENGINEERING_ASSOCIATE_PROFESSOR_RESUME,
  ECONOMICS_FACULTY_DEAN_RESUME,
  RENEWABLE_ENERGY_RESEARCH_FELLOW_RESUME,
  GROWTH_MARKETING_MANAGER_RESUME,
  ENTERPRISE_ACCOUNT_EXECUTIVE_RESUME,
  BRAND_CAMPAIGN_MANAGER_RESUME,
  DEVOPS_ENGINEER_RESUME,
  MOBILE_ENGINEER_RESUME,
  FINANCIAL_ACCOUNTANT_RESUME,
  COMPLIANCE_OFFICER_RESUME,
  FAMILY_MEDICINE_PHYSICIAN_RESUME,
  HOSPITAL_PHYSICIAN_RESUME,
  IN_HOUSE_LEGAL_COUNSEL_RESUME,
  LITIGATION_COUNSEL_RESUME,
  CIVIL_REGISTRATION_OFFICER_RESUME,
  GOVERNMENT_PRESS_OFFICER_RESUME,
  CIVIL_SERVICE_ADMINISTRATOR_RESUME,
  INFRASTRUCTURE_PROJECT_MANAGER_RESUME,
  PROGRAM_MANAGER_RESUME,
  AGILE_DELIVERY_MANAGER_RESUME,
  WAREHOUSE_OPERATIONS_MANAGER_RESUME,
  FLEET_ROUTE_PLANNING_MANAGER_RESUME,
  SUPPLY_CHAIN_PROCUREMENT_MANAGER_RESUME,
  BYLINE_JOURNALIST_RESUME,
  REEL_VIDEO_EDITOR_RESUME,
  PRESS_KIT_PUBLICIST_RESUME,
  FIELD_CUSTOMER_SUCCESS_MANAGER_RESUME,
  TECHNICAL_HELP_DESK_SPECIALIST_RESUME,
  CUSTOMER_SUCCESS_RENEWALS_MANAGER_RESUME,
  PRODUCT_UX_DESIGNER_RESUME,
  GRAPHIC_BRAND_DESIGNER_RESUME,
  CREATIVE_DIRECTOR_STUDIO_RESUME,
  HOTEL_CONCIERGE_RESUME,
  HOTEL_FRONT_DESK_SUPERVISOR_RESUME,
  TRAVEL_ITINERARY_COORDINATOR_RESUME,
  NOC_FIELD_NETWORK_ENGINEER_RESUME,
  RF_TRANSMISSION_ENGINEER_RESUME,
  NETWORK_RELIABILITY_ENGINEER_RESUME,
} from "@/lib/resume-builder/preview-sample";
import { RESUME_TEMPLATES } from "@/lib/billing/catalog";

const ENGINEERING_GROUP_CATEGORIES = ["Engineering", "Construction & Real Estate", "Oil & Gas / Energy"];
const NGO_AGRICULTURE_CATEGORIES = ["NGO & Development", "Agriculture & Agribusiness"];
// NOTE: batch 2's `STANDALONE_BATCH_2_SLUGS` list (the 5 one-slug-per-category
// exceptions — `product-tech`/`ledger`/`care-plan`/`chambers`/`business-memo`)
// lived here through batch 3B, feeding the "everything else falls back"
// aggregator test below it. That test is retired as of batch 3C (see this
// file's own header — there is nothing left for it to assert against), and
// the 5 slugs' own per-slug resolution is still covered by the "resolves
// batch-2 standalone-category slug" test above, so the list itself is no
// longer referenced and was removed rather than kept as dead code.
// BATCH 3A — 5 categories, each FULLY split (every slug in the category has
// its own dedicated persona), unlike batch 2's standalone-slug pattern above.
const BATCH_3A_FULL_CATEGORIES = ["Administration", "Business", "Technology", "Sales & Marketing", "Education & Academia"];
// BATCH 3B — Banking & Finance, Healthcare and Legal (each had exactly one
// batch-2 standalone slug — `ledger`/`care-plan`/`chambers` — and now have
// their other two siblings mapped too) plus three brand-new categories
// completed in full: Government & Public Sector, Project Management,
// Logistics & Supply Chain.
const BATCH_3B_FULL_CATEGORIES = [
  "Banking & Finance",
  "Healthcare",
  "Legal",
  "Government & Public Sector",
  "Project Management",
  "Logistics & Supply Chain",
];
// BATCH 3C (third and final) — 5 more brand-new categories, each fully
// completed in one pass, closing out the last of the 44 fallback slugs
// batches 3A and 3B left standing.
const BATCH_3C_FULL_CATEGORIES = [
  "Creative & Media",
  "Customer Success",
  "Design",
  "Hospitality & Travel",
  "Telecommunications",
];

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

  it.each([
    ["structured-admin", EXECUTIVE_ADMINISTRATIVE_ASSISTANT_RESUME],
    ["front-office", FRONT_OFFICE_MANAGER_RESUME],
    ["filing-system", RECORDS_DOCUMENTATION_OFFICER_RESUME],
    ["clean-professional", BUSINESS_GENERALIST_RESUME],
    ["business-boardroom", CHIEF_OPERATING_OFFICER_RESUME],
    ["terminal", DEVOPS_ENGINEER_RESUME],
    ["stack-trace", MOBILE_ENGINEER_RESUME],
    ["funnel", GROWTH_MARKETING_MANAGER_RESUME],
    ["pipeline", ENTERPRISE_ACCOUNT_EXECUTIVE_RESUME],
    ["pitch-deck", BRAND_CAMPAIGN_MANAGER_RESUME],
    ["curriculum-vitae", MICROBIOLOGY_LECTURER_RESUME],
    ["lecture-notes", ENGINEERING_ASSOCIATE_PROFESSOR_RESUME],
    ["faculty-profile", ECONOMICS_FACULTY_DEAN_RESUME],
    ["research-record", RENEWABLE_ENERGY_RESEARCH_FELLOW_RESUME],
  ])("resolves batch-3A slug %s to its own dedicated persona", (slug, persona) => {
    expect(personaForSlug(slug)).toBe(persona);
    expect(personaForSlug(slug)).not.toBe(PREVIEW_SAMPLE_RESUME);
  });

  // `clean-professional` gets its own explicit check: before batch 3A it was
  // BOTH `getTemplateComponent`'s fallback component AND (via this
  // function's own fallback) `PREVIEW_SAMPLE_RESUME` — the two fallbacks
  // happened to agree. Now that it has its own persona, this pins down that
  // it resolves to something OTHER than the shared PM fallback, closing the
  // gap a generic "not PREVIEW_SAMPLE_RESUME" check already covers above but
  // naming the specific regression this guards (silently routing
  // `clean-professional` back through the persona fallback because it's
  // also the template-component fallback).
  it("clean-professional resolves to its own generalist persona, not the shared PREVIEW_SAMPLE_RESUME fallback it used to share an outcome with", () => {
    expect(personaForSlug("clean-professional")).toBe(BUSINESS_GENERALIST_RESUME);
    expect(personaForSlug("clean-professional")).not.toBe(PREVIEW_SAMPLE_RESUME);
  });

  it.each([
    ["balance-sheet", FINANCIAL_ACCOUNTANT_RESUME],
    ["compliance-brief", COMPLIANCE_OFFICER_RESUME],
    ["clinical", FAMILY_MEDICINE_PHYSICIAN_RESUME],
    ["rounds", HOSPITAL_PHYSICIAN_RESUME],
    ["legal-brief", IN_HOUSE_LEGAL_COUNSEL_RESUME],
    ["statute", LITIGATION_COUNSEL_RESUME],
    ["civic-record", CIVIL_REGISTRATION_OFFICER_RESUME],
    ["gazette", GOVERNMENT_PRESS_OFFICER_RESUME],
    ["public-record", CIVIL_SERVICE_ADMINISTRATOR_RESUME],
    ["critical-path", INFRASTRUCTURE_PROJECT_MANAGER_RESUME],
    ["gantt", PROGRAM_MANAGER_RESUME],
    ["sprint-board", AGILE_DELIVERY_MANAGER_RESUME],
    ["manifest", WAREHOUSE_OPERATIONS_MANAGER_RESUME],
    ["route-plan", FLEET_ROUTE_PLANNING_MANAGER_RESUME],
    ["supply-chain", SUPPLY_CHAIN_PROCUREMENT_MANAGER_RESUME],
  ])("resolves batch-3B slug %s to its own dedicated persona", (slug, persona) => {
    expect(personaForSlug(slug)).toBe(persona);
    expect(personaForSlug(slug)).not.toBe(PREVIEW_SAMPLE_RESUME);
  });

  it.each([
    ["byline", BYLINE_JOURNALIST_RESUME],
    ["press-kit", PRESS_KIT_PUBLICIST_RESUME],
    ["reel", REEL_VIDEO_EDITOR_RESUME],
    ["field-notes", FIELD_CUSTOMER_SUCCESS_MANAGER_RESUME],
    ["help-desk", TECHNICAL_HELP_DESK_SPECIALIST_RESUME],
    ["success-story", CUSTOMER_SUCCESS_RENEWALS_MANAGER_RESUME],
    ["design-showcase", PRODUCT_UX_DESIGNER_RESUME],
    ["portfolio-grid", GRAPHIC_BRAND_DESIGNER_RESUME],
    ["studio-brief", CREATIVE_DIRECTOR_STUDIO_RESUME],
    ["concierge", HOTEL_CONCIERGE_RESUME],
    ["front-desk", HOTEL_FRONT_DESK_SUPERVISOR_RESUME],
    ["itinerary", TRAVEL_ITINERARY_COORDINATOR_RESUME],
    ["network-ops", NOC_FIELD_NETWORK_ENGINEER_RESUME],
    ["signal", RF_TRANSMISSION_ENGINEER_RESUME],
    ["uptime", NETWORK_RELIABILITY_ENGINEER_RESUME],
  ])("resolves batch-3C slug %s to its own dedicated persona", (slug, persona) => {
    expect(personaForSlug(slug)).toBe(persona);
    expect(personaForSlug(slug)).not.toBe(PREVIEW_SAMPLE_RESUME);
  });

  /**
   * THE DEFINITIVE REGRESSION GUARD this whole three-batch effort was
   * building toward: not a computed "remaining" subset (that test is
   * retired — see this file's own header for why), but every single slug
   * the live catalog actually has, checked directly. If a new template is
   * ever added to `RESUME_TEMPLATES` without also earning its own
   * `SLUG_PERSONA_MAP` entry, THIS is the test that fails and names it.
   */
  it("every catalog slug in RESUME_TEMPLATES resolves to a dedicated persona, not the PREVIEW_SAMPLE_RESUME fallback", () => {
    expect(RESUME_TEMPLATES.length).toBeGreaterThan(0);
    const offenders = RESUME_TEMPLATES.filter((t) => personaForSlug(t.slug) === PREVIEW_SAMPLE_RESUME).map(
      (t) => t.slug,
    );
    expect(offenders, `slug(s) still falling back to PREVIEW_SAMPLE_RESUME: ${offenders.join(", ")}`).toEqual([]);
  });

  it("falls back rather than crashing for an unknown or missing slug — a genuinely fake slug, since no real catalog slug is unmapped anymore", () => {
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

  it.each(BATCH_3A_FULL_CATEGORIES)(
    "the %s category's live slug list is entirely off the fallback as of batch 3A (guards against catalog drift)",
    (category) => {
      const slugs = RESUME_TEMPLATES.filter((t) => t.industry_category === category).map((t) => t.slug);
      // Sanity: the category still has slugs in the live catalog to check.
      expect(slugs.length).toBeGreaterThan(0);
      for (const slug of slugs) {
        expect(personaForSlug(slug), `slug "${slug}" (category "${category}")`).not.toBe(PREVIEW_SAMPLE_RESUME);
      }
    },
  );

  it.each(BATCH_3B_FULL_CATEGORIES)(
    "the %s category's live slug list is entirely off the fallback as of batch 3B (guards against catalog drift)",
    (category) => {
      const slugs = RESUME_TEMPLATES.filter((t) => t.industry_category === category).map((t) => t.slug);
      // Sanity: the category still has slugs in the live catalog to check.
      expect(slugs.length).toBeGreaterThan(0);
      for (const slug of slugs) {
        expect(personaForSlug(slug), `slug "${slug}" (category "${category}")`).not.toBe(PREVIEW_SAMPLE_RESUME);
      }
    },
  );

  it.each(BATCH_3C_FULL_CATEGORIES)(
    "the %s category's live slug list is entirely off the fallback as of batch 3C (guards against catalog drift)",
    (category) => {
      const slugs = RESUME_TEMPLATES.filter((t) => t.industry_category === category).map((t) => t.slug);
      // Sanity: the category still has slugs in the live catalog to check.
      expect(slugs.length).toBeGreaterThan(0);
      for (const slug of slugs) {
        expect(personaForSlug(slug), `slug "${slug}" (category "${category}")`).not.toBe(PREVIEW_SAMPLE_RESUME);
      }
    },
  );
});
