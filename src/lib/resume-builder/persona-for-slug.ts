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
 * BATCH 2 (this pass) finishes that grouping: `field-mission` keeps
 * `DEVELOPMENT_PROGRAMME_OFFICER_RESUME` unchanged (its `structure_schema`
 * already has `volunteering`, matching content Ngozi already has, and
 * "Programme Experience" matches her summary/title closely); the other 5
 * (`impact-report`, `grant-proposal`, `harvest`, `field-season`,
 * `value-chain`) each get their own new persona. This pass also adds 5 new
 * entries on standalone-category slugs that were on the `PREVIEW_SAMPLE_
 * RESUME` fallback before now: one each from Technology, Banking & Finance,
 * Healthcare, Legal and Business — see `preview-sample.ts`'s own header for
 * why those 5 specific categories. Every slug not listed here still falls
 * through to `PREVIEW_SAMPLE_RESUME`, unchanged.
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

  // Standalone categories — one dedicated slug each, new as of batch 2, out
  // of 5 different categories (Technology, Banking & Finance, Healthcare,
  // Legal, Business) still entirely on the fallback before this pass. Every
  // OTHER slug in each of these categories (e.g. `terminal`/`stack-trace` in
  // Technology) is deliberately left on `PREVIEW_SAMPLE_RESUME` — this batch
  // adds one persona per category, not a full category split.
  "product-tech": SOFTWARE_ENGINEER_RESUME,
  ledger: CREDIT_RISK_ANALYST_RESUME,
  "care-plan": REGISTERED_NURSE_RESUME,
  chambers: CORPORATE_LEGAL_ASSOCIATE_RESUME,
  "business-memo": BUSINESS_OPERATIONS_MANAGER_RESUME,
};

/**
 * The slug -> persona resolver both seeding call sites use
 * (createResumeAction's "example" start state, template-thumbnail.tsx's
 * gallery preview).
 *
 * FALLS BACK TO `PREVIEW_SAMPLE_RESUME` for any slug not in the map above —
 * every catalog slug across the two passes so far hasn't built a dedicated
 * persona for, plus `null`/`undefined`/an unrecognized string. This is
 * deliberately a fallback to a SANE, already-shipped persona rather than a
 * thrown error or a blank resume — an unmapped slug must still produce a
 * usable "start from an example", not a crash, exactly the same way
 * `getTemplateComponent` falls back to `clean-professional` for an unmapped
 * slug rather than throwing (see template-registry.test.ts's "falls back
 * ... for an unmapped or missing slug").
 */
export function personaForSlug(slug: string | null | undefined): StructuredResume {
  if (!slug) return PREVIEW_SAMPLE_RESUME;
  return SLUG_PERSONA_MAP[slug] ?? PREVIEW_SAMPLE_RESUME;
}
