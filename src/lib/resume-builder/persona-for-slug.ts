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
 * THIS PASS ONLY SPLITS THE ENGINEERING/CONSTRUCTION/OIL & GAS GROUPING.
 * `blueprint` keeps `EPC_SITE_ENGINEER_RESUME`; the other 9 slugs in that
 * grouping (site-report, specification, schematic, site-plan, foundation,
 * property-portfolio, rig-report, offshore, wellhead) each get their own new
 * persona from `preview-sample.ts`. The NGO & Development / Agriculture &
 * Agribusiness grouping (field-mission, impact-report, grant-proposal,
 * harvest, field-season, value-chain) is listed here explicitly too, one
 * entry per slug — but every one of those 6 still points at the SAME
 * `DEVELOPMENT_PROGRAMME_OFFICER_RESUME` persona, unchanged from before this
 * pass. Only the mechanism changed (explicit per-slug entries instead of a
 * category match); splitting that grouping into 6 distinct personas is
 * explicitly out of scope for this batch. Every slug not listed here falls
 * through to `PREVIEW_SAMPLE_RESUME`, exactly as it did before this pass —
 * see `personaForSlug`'s own comment for the full list of what that covers.
 */
const SLUG_PERSONA_MAP: Record<string, StructuredResume> = {
  // Engineering + Construction & Real Estate + Oil & Gas/Energy — one
  // dedicated persona per slug, as of this pass.
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

  // NGO & Development + Agriculture & Agribusiness — still one shared
  // persona across all 6 slugs, unchanged in outcome from the category-keyed
  // version. Listed per-slug (not per-category) on purpose, so this map's
  // shape is uniform and doesn't quietly reintroduce a category lookup.
  "field-mission": DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
  "impact-report": DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
  "grant-proposal": DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
  harvest: DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
  "field-season": DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
  "value-chain": DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
};

/**
 * The slug -> persona resolver both seeding call sites use
 * (createResumeAction's "example" start state, template-thumbnail.tsx's
 * gallery preview).
 *
 * FALLS BACK TO `PREVIEW_SAMPLE_RESUME` for any slug not in the map above —
 * every one of the ~53 remaining catalog slugs this pass didn't build a
 * dedicated persona for, plus `null`/`undefined`/an unrecognized string.
 * This is deliberately a fallback to a SANE, already-shipped persona rather
 * than a thrown error or a blank resume — an unmapped slug must still
 * produce a usable "start from an example", not a crash, exactly the same
 * way `getTemplateComponent` falls back to `clean-professional` for an
 * unmapped slug rather than throwing (see template-registry.test.ts's
 * "falls back ... for an unmapped or missing slug").
 */
export function personaForSlug(slug: string | null | undefined): StructuredResume {
  if (!slug) return PREVIEW_SAMPLE_RESUME;
  return SLUG_PERSONA_MAP[slug] ?? PREVIEW_SAMPLE_RESUME;
}
