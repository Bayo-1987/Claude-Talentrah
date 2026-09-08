import type { StructuredResume } from "@/lib/resume/types";
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
} from "@/lib/resume-builder/preview-sample";

/**
 * Renamed from `persona-for-category.ts` (batch 1 of the per-slug persona
 * rollout). The resolver USED to be keyed off `resume_templates.
 * industry_category` — a whole category grouping (Engineering + Construction
 * & Real Estate + Oil & Gas/Energy, 10 templates) shared one persona. The
 * founder decided that was wrong: every template should get its own persona.
 * This file is the mechanical result — `SLUG_PERSONA_MAP` is now keyed by
 * literal template `slug`, not category, and `personaForCategory` no longer
 * exists (see `personaForSlug` below's own comment for why it was dropped
 * rather than kept alongside).
 *
 * BATCH 1 split the Engineering/Construction/Oil & Gas grouping (`blueprint`
 * keeps `EPC_SITE_ENGINEER_RESUME`; the other 9 slugs each got their own new
 * persona) and left the NGO & Development / Agriculture & Agribusiness
 * grouping's 6 slugs all pointing at the same `DEVELOPMENT_PROGRAMME_OFFICER_
 * RESUME`, on purpose, pending this batch.
 *
 * BATCH 2 finished that grouping: `field-mission` keeps
 * `DEVELOPMENT_PROGRAMME_OFFICER_RESUME` unchanged (its `structure_schema`
 * already has `volunteering`, matching content Ngozi already has, and
 * "Programme Experience" matches her summary/title closely); the other 5
 * (`impact-report`, `grant-proposal`, `harvest`, `field-season`,
 * `value-chain`) each got their own new persona. That pass also added 5 new
 * entries on standalone-category slugs that were on the `PREVIEW_SAMPLE_
 * RESUME` fallback before it: one each from Technology, Banking & Finance,
 * Healthcare, Legal and Business — see `preview-sample.ts`'s own header for
 * why those 5 specific categories.
 *
 * BATCH 3A (first of three closing the remaining 44 fallback slugs) added 14
 * entries across 5 categories, completing every one of them: Administration
 * (`structured-admin`, `front-office`, `filing-system`), Business
 * (`clean-professional`, `business-boardroom` — joining batch 2's
 * `business-memo`), Technology (`terminal`, `stack-trace` — joining batch
 * 2's `product-tech`), Sales & Marketing (`funnel`, `pipeline`,
 * `pitch-deck`) and Education & Academia (`curriculum-vitae`,
 * `lecture-notes`, `faculty-profile`, `research-record`). See
 * `preview-sample.ts`'s own header for the full reasoning, including why
 * `clean-professional` — this function's own fallback destination — getting
 * a dedicated persona was a special case worth its own writeup.
 *
 * BATCH 3B (this pass, second of three) adds 15 more entries, all premium
 * (none of this batch sits in the free tier): Banking & Finance
 * (`balance-sheet`, `compliance-brief` — joining batch 2's `ledger`),
 * Healthcare (`clinical`, `rounds` — joining batch 2's `care-plan`), Legal
 * (`legal-brief`, `statute` — joining batch 2's `chambers`), and three
 * brand-new categories completed in full: Government & Public Sector
 * (`civic-record`, `gazette`, `public-record`), Project Management
 * (`critical-path`, `gantt`, `sprint-board`) and Logistics & Supply Chain
 * (`manifest`, `route-plan`, `supply-chain`). Four of these fifteen —
 * `clinical`, `statute`, `critical-path`, `public-record` — are bespoke
 * components with no `structure_schema`, matched against their own template
 * file the same way batch 3A matched `pipeline`. See `preview-sample.ts`'s
 * own header for the full reasoning, including why each three-way category
 * got a genuinely distinct sub-specialty per slug rather than a title swap.
 *
 * Every slug not listed here still falls through to `PREVIEW_SAMPLE_RESUME`
 * — exactly 15 slugs remain out of the catalog's 65 (50 now mapped above),
 * across categories batch 3C hasn't reached yet: Design (`design-showcase`,
 * `studio-brief`, `portfolio-grid`), Customer Success (`field-notes`,
 * `success-story`, `help-desk`), Creative & Media (`byline`, `reel`,
 * `press-kit`), Telecommunications (`network-ops`, `signal`, `uptime`) and
 * Hospitality & Travel (`front-desk`, `concierge`, `itinerary`).
 */
const SLUG_PERSONA_MAP: Record<string, StructuredResume> = {
  // Engineering + Construction & Real Estate + Oil & Gas/Energy — one
  // dedicated persona per slug, since batch 1.
  blueprint: EPC_SITE_ENGINEER_RESUME,
  "site-report": CONSTRUCTION_FOREMAN_RESUME,
  specification: STRUCTURAL_DESIGN_ENGINEER_RESUME,
  schematic: ELECTRICAL_DESIGN_ENGINEER_RESUME,
  "site-plan": LAND_SURVEYOR_RESUME,
  foundation: GEOTECHNICAL_ENGINEER_RESUME,
  "property-portfolio": REAL_ESTATE_DEVELOPMENT_MANAGER_RESUME,
  "rig-report": DRILLING_RIG_SUPERVISOR_RESUME,
  offshore: OFFSHORE_PROCESS_ENGINEER_RESUME,
  wellhead: WELLHEAD_COMPLETIONS_ENGINEER_RESUME,

  // NGO & Development + Agriculture & Agribusiness — `field-mission` keeps
  // the shared persona from batch 1; the other 5 each get their own new one
  // as of batch 2 (this pass).
  "field-mission": DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
  "impact-report": IMPACT_REPORTING_OFFICER_RESUME,
  "grant-proposal": GRANTS_PROPOSAL_OFFICER_RESUME,
  harvest: COMMERCIAL_AGRONOMIST_RESUME,
  "field-season": FIELD_PRODUCTION_SUPERVISOR_RESUME,
  "value-chain": VALUE_CHAIN_ANALYST_RESUME,

  // Standalone categories — one dedicated slug each, added in batch 2, out
  // of 5 different categories (Technology, Banking & Finance, Healthcare,
  // Legal, Business) still entirely on the fallback before that pass. Batch
  // 2 deliberately left every OTHER slug in each of these categories (e.g.
  // `terminal`/`stack-trace` in Technology) on `PREVIEW_SAMPLE_RESUME` — one
  // persona per category, not a full category split. Technology and
  // Business are now fully split as of batch 3A below (see that section);
  // Banking & Finance, Healthcare and Legal still have unmapped siblings.
  "product-tech": SOFTWARE_ENGINEER_RESUME,
  ledger: CREDIT_RISK_ANALYST_RESUME,
  "care-plan": REGISTERED_NURSE_RESUME,
  chambers: CORPORATE_LEGAL_ASSOCIATE_RESUME,
  "business-memo": BUSINESS_OPERATIONS_MANAGER_RESUME,

  // BATCH 3A — 5 categories, each fully completed (see this file's own
  // header and preview-sample.ts's header for the full reasoning).
  "structured-admin": EXECUTIVE_ADMINISTRATIVE_ASSISTANT_RESUME,
  "front-office": FRONT_OFFICE_MANAGER_RESUME,
  "filing-system": RECORDS_DOCUMENTATION_OFFICER_RESUME,

  "clean-professional": BUSINESS_GENERALIST_RESUME,
  "business-boardroom": CHIEF_OPERATING_OFFICER_RESUME,

  terminal: DEVOPS_ENGINEER_RESUME,
  "stack-trace": MOBILE_ENGINEER_RESUME,

  funnel: GROWTH_MARKETING_MANAGER_RESUME,
  pipeline: ENTERPRISE_ACCOUNT_EXECUTIVE_RESUME,
  "pitch-deck": BRAND_CAMPAIGN_MANAGER_RESUME,

  "curriculum-vitae": MICROBIOLOGY_LECTURER_RESUME,
  "lecture-notes": ENGINEERING_ASSOCIATE_PROFESSOR_RESUME,
  "faculty-profile": ECONOMICS_FACULTY_DEAN_RESUME,
  "research-record": RENEWABLE_ENERGY_RESEARCH_FELLOW_RESUME,

  // BATCH 3B — Banking & Finance and Healthcare and Legal each gain a
  // second dedicated slug (joining `ledger`/`care-plan`/`chambers` above),
  // and three brand-new categories are completed in full (see this file's
  // own header and preview-sample.ts's header for the full reasoning,
  // including which four of these are bespoke components rather than
  // skeleton-config slugs).
  "balance-sheet": FINANCIAL_ACCOUNTANT_RESUME,
  "compliance-brief": COMPLIANCE_OFFICER_RESUME,

  clinical: FAMILY_MEDICINE_PHYSICIAN_RESUME,
  rounds: HOSPITAL_PHYSICIAN_RESUME,

  "legal-brief": IN_HOUSE_LEGAL_COUNSEL_RESUME,
  statute: LITIGATION_COUNSEL_RESUME,

  "civic-record": CIVIL_REGISTRATION_OFFICER_RESUME,
  gazette: GOVERNMENT_PRESS_OFFICER_RESUME,
  "public-record": CIVIL_SERVICE_ADMINISTRATOR_RESUME,

  "critical-path": INFRASTRUCTURE_PROJECT_MANAGER_RESUME,
  gantt: PROGRAM_MANAGER_RESUME,
  "sprint-board": AGILE_DELIVERY_MANAGER_RESUME,

  manifest: WAREHOUSE_OPERATIONS_MANAGER_RESUME,
  "route-plan": FLEET_ROUTE_PLANNING_MANAGER_RESUME,
  "supply-chain": SUPPLY_CHAIN_PROCUREMENT_MANAGER_RESUME,
};

/**
 * The slug -> persona resolver both seeding call sites use
 * (createResumeAction's "example" start state, template-thumbnail.tsx's
 * gallery preview).
 *
 * FALLS BACK TO `PREVIEW_SAMPLE_RESUME` for any slug not in the map above —
 * roughly 30 catalog slugs remain unmapped after batch 3A (see this file's
 * own header for exactly which categories), plus `null`/`undefined`/an
 * unrecognized string. This is deliberately a fallback to a SANE,
 * already-shipped persona rather than a thrown error or a blank resume — an
 * unmapped slug must still produce a usable "start from an example", not a
 * crash, exactly the same way `getTemplateComponent` falls back to
 * `clean-professional` for an unmapped slug rather than throwing (see
 * template-registry.test.ts's "falls back ... for an unmapped or missing
 * slug"). NOTE: that fallback is about `getTemplateComponent` resolving
 * which REACT COMPONENT to render for an unrecognized slug — a completely
 * different fallback from this one, which resolves which PERSONA to seed.
 * They happen to share a destination in one case (`clean-professional` is
 * both `getTemplateComponent`'s fallback AND, before batch 3A, this
 * function's fallback too) but `clean-professional` now has its own
 * dedicated persona (`BUSINESS_GENERALIST_RESUME`) here — the two fallbacks
 * are independent and this one no longer routes through it.
 */
export function personaForSlug(slug: string | null | undefined): StructuredResume {
  if (!slug) return PREVIEW_SAMPLE_RESUME;
  return SLUG_PERSONA_MAP[slug] ?? PREVIEW_SAMPLE_RESUME;
}
