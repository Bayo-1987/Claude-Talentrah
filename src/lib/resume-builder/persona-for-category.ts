import type { StructuredResume } from "@/lib/resume/types";
import {
  PREVIEW_SAMPLE_RESUME,
  EPC_SITE_ENGINEER_RESUME,
  DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
} from "@/lib/resume-builder/preview-sample";
import { RESUME_TEMPLATES } from "@/lib/billing/catalog";

/**
 * `resume_templates.industry_category` -> which persona from
 * `EXAMPLE_PERSONAS` (preview-sample.ts) represents it. The two keys used
 * here — Engineering/Construction & Real Estate/Oil & Gas/Energy and
 * NGO & Development/Agriculture & Agribusiness — are exactly the two
 * groupings this pass built a dedicated persona for; every other category
 * string in `RESUME_TEMPLATES` (src/lib/billing/catalog.ts) has no entry
 * here and falls through to `PREVIEW_SAMPLE_RESUME` in `personaForCategory`
 * below, on purpose (see that function's own comment).
 *
 * Category strings are the exact literals `RESUME_TEMPLATES` uses — this is
 * NOT re-deriving a taxonomy, it's keying off the one that already exists.
 */
const CATEGORY_PERSONA_MAP: Record<string, StructuredResume> = {
  Engineering: EPC_SITE_ENGINEER_RESUME,
  "Construction & Real Estate": EPC_SITE_ENGINEER_RESUME,
  "Oil & Gas / Energy": EPC_SITE_ENGINEER_RESUME,
  "NGO & Development": DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
  "Agriculture & Agribusiness": DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
};

/**
 * The category -> persona resolver both seeding call sites use
 * (createResumeAction's "example" start state, template-thumbnail.tsx via
 * `personaForSlug` below).
 *
 * FALLS BACK TO `PREVIEW_SAMPLE_RESUME` for any category not in the map
 * above — every one of the ~12-13 categories this pass didn't build a
 * dedicated persona for (Administration, Customer Success, Technology,
 * Design, Banking & Finance, Sales & Marketing, Healthcare, Legal,
 * Government & Public Sector, Education & Academia, Creative & Media,
 * Hospitality & Travel, Telecommunications, Logistics & Supply Chain,
 * Business, Project Management), plus `null`/`undefined`/an unrecognized
 * string. This is deliberately a fallback to a SANE, already-shipped
 * persona rather than a thrown error or a blank resume — an unmapped
 * category must still produce a usable "start from an example", not a
 * crash, exactly the same way `getTemplateComponent` falls back to
 * `clean-professional` for an unmapped slug rather than throwing (see
 * template-registry.test.ts's "falls back ... for an unmapped or missing
 * slug").
 */
export function personaForCategory(category: string | null | undefined): StructuredResume {
  if (!category) return PREVIEW_SAMPLE_RESUME;
  return CATEGORY_PERSONA_MAP[category] ?? PREVIEW_SAMPLE_RESUME;
}

/**
 * slug -> `resume_templates` row, built once at module load from
 * `RESUME_TEMPLATES` (src/lib/billing/catalog.ts) — the same catalog
 * `TemplateCard` reads `industry_category` from to show it next to the
 * template name.
 */
const RESUME_TEMPLATES_BY_SLUG = new Map(RESUME_TEMPLATES.map((t) => [t.slug, t]));

/**
 * template-thumbnail.tsx's entry point: it only has a `slug`, not a
 * category, so this looks the category up from `RESUME_TEMPLATES` before
 * resolving a persona. An unknown slug (should not happen for a live
 * catalog row, but the thumbnail already has to survive one — see its own
 * "falls back to the default" handling) resolves the same way an unmapped
 * category does: `PREVIEW_SAMPLE_RESUME`, never a crash.
 */
export function personaForSlug(slug: string | null | undefined): StructuredResume {
  if (!slug) return PREVIEW_SAMPLE_RESUME;
  const category = RESUME_TEMPLATES_BY_SLUG.get(slug)?.industry_category;
  return personaForCategory(category);
}
