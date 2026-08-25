import { createElement, type ComponentType } from "react";
import type { StructuredResume } from "@/lib/resume/types";
import { ResumeDocument } from "../resume-document";
import { ClinicalTemplate } from "./clinical";
import { StatuteTemplate } from "./statute";
import { CriticalPathTemplate } from "./critical-path";
import { PublicRecordTemplate } from "./public-record";
import { PortfolioGridTemplate } from "./portfolio-grid";
import { PipelineTemplate } from "./pipeline";
import type { TemplateProps } from "./shared";

export type { TemplateProps } from "./shared";

/**
 * slug → component. The registry keys off `slug` and nothing else.
 *
 * WHY SLUG AND NOT name OR id. `name` is editable catalog copy with no unique
 * constraint, so keying on it means renaming a template silently unmaps its
 * layout — no error, just every resume using it quietly falling back to the
 * default. `id` is a per-environment uuid, so a registry keyed on it could not
 * be committed to source at all. `slug` is stable, unique (migration 0042) and
 * identical in every environment.
 *
 * WHY A FALLBACK RATHER THAN A THROW. A catalog row can exist without a
 * component — someone adds an entry ahead of its design, or a component is
 * renamed in a bad merge. The user's resume must still render: their content is
 * intact either way, and a resume laid out in the wrong style is recoverable
 * where a crashed page is not. `tests/resume-builder/template-registry.test.ts`
 * asserts every row in the LIVE catalog has a component, so the fallback is a
 * safety net rather than a way to quietly ship unmapped templates.
 */
export const DEFAULT_TEMPLATE_SLUG = "clean-professional";

const REGISTRY: Record<string, ComponentType<TemplateProps>> = {
  // The original layout, unchanged — what every resume rendered as before the
  // library existed, regardless of which template had been chosen or paid for.
  "clean-professional": ResumeDocument,
  clinical: ClinicalTemplate,
  statute: StatuteTemplate,
  "critical-path": CriticalPathTemplate,
  "public-record": PublicRecordTemplate,
  // Not part of the four new templates. Both were already PREMIUM at 10
  // credits and rendered as the free default, i.e. paid products delivering
  // nothing. Fixed here because this is the pass that made distinct layouts
  // possible at all; the registry test now refuses to let a premium template
  // sit in that state.
  "portfolio-grid": PortfolioGridTemplate,
  pipeline: PipelineTemplate,
};

export function getTemplateComponent(slug: string | null | undefined): ComponentType<TemplateProps> {
  if (!slug) return REGISTRY[DEFAULT_TEMPLATE_SLUG];
  return REGISTRY[slug] ?? REGISTRY[DEFAULT_TEMPLATE_SLUG];
}

/** Slugs with a real, distinct layout. Exported for the catalog-vs-registry
 *  test and for the gallery to mark which templates actually render
 *  differently from the default. */
export function registeredSlugs(): string[] {
  return Object.keys(REGISTRY);
}

/**
 * Renders the template for a slug.
 *
 * `createElement` rather than `const T = getTemplateComponent(...)` followed by
 * `<T />`: assigning a component to a capitalised local during render trips
 * react-hooks/static-components, and the rule is right in general — a component
 * *value* that changes identity between renders remounts its subtree and resets
 * its state. Not a live risk here (server component, static lookup table), but
 * routing every caller through this one function means no page can reintroduce
 * the pattern, and `getTemplateComponent` stays the single source of truth for
 * the mapping rather than being duplicated into a switch.
 */
export function TemplateRenderer({
  slug,
  resume,
}: {
  slug: string | null | undefined;
  resume: StructuredResume;
}) {
  return createElement(getTemplateComponent(slug), { resume });
}
