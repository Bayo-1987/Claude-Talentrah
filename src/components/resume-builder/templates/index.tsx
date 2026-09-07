import { createElement, type ComponentType } from "react";
import type { StructuredResume } from "@/lib/resume/types";
import { ResumeDocument } from "../resume-document";
import { ClinicalTemplate } from "./clinical";
import { StatuteTemplate } from "./statute";
import { CriticalPathTemplate } from "./critical-path";
import { PublicRecordTemplate } from "./public-record";
import { PortfolioGridTemplate } from "./portfolio-grid";
import { PipelineTemplate } from "./pipeline";
import { CLEAN_PROFESSIONAL_CONFIG } from "../skeletons/configs";
import { CATALOG_TEMPLATE_CONFIGS } from "../skeletons/catalog-configs";
import { createConfiguredTemplateComponent } from "../skeletons";
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

/**
 * Every slug PR3 gives a real skeleton config to (the 4 formerly-fallback
 * PR2 slugs plus the 54 new templates) — one `ComponentType` per entry in
 * `CATALOG_TEMPLATE_CONFIGS` (skeletons/catalog-configs.ts), built the same
 * way `product-tech-preview`'s dev-page demo already does
 * (`createConfiguredTemplateComponent`). Generated from that map rather than
 * listed by hand so a slug added there is registered automatically and
 * cannot drift out of sync with it.
 */
const CONFIGURED_REGISTRY: Record<string, ComponentType<TemplateProps>> = Object.fromEntries(
  Object.entries(CATALOG_TEMPLATE_CONFIGS).map(([slug, config]) => [
    slug,
    createConfiguredTemplateComponent(config),
  ]),
);

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
  // Template library PR3 — 4 fixed fallback slugs + 54 new templates, all
  // skeleton-configured rather than bespoke components.
  ...CONFIGURED_REGISTRY,
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

/**
 * ATS-safety per slug — Template library PR 2 of 3.
 *
 * `true` means: no sidebar, no banded/graphic header, no CSS grid splitting
 * unrelated sections into side-by-side blocks, standard headings, and text
 * that extracts from a generated PDF in the same order a human reads it.
 * This is a real, verified claim, not a description of intent —
 * `e2e/ats-safety.spec.ts` renders each of the seven
 * skeletons to an actual PDF and asserts on the actual extracted text order.
 * The six bespoke (non-skeleton) components below were classified by the
 * same standard against their real DOM structure, not by skeleton test —
 * see the reasoning per slug.
 *
 * `clean-professional`'s value comes from its own config
 * (`CLEAN_PROFESSIONAL_CONFIG.atsSafe`, skeletons/configs.ts) rather than
 * being repeated here, so the two can't quietly drift apart. Every
 * PR3-configured slug (the 4 formerly-fallback ones plus the 54 new
 * templates) is the same idea applied to a whole map instead of one value —
 * see `CONFIGURED_ATS_SAFETY` below.
 */
export const TEMPLATE_ATS_SAFETY: Record<string, boolean> = {
  "clean-professional": CLEAN_PROFESSIONAL_CONFIG.atsSafe,
  // Pure single column, centred masthead — Statute's whole design brief is
  // restraint; nothing is ever placed side-by-side.
  statute: true,
  // A `<div className="grid grid-cols-[128px_1fr]">` PER FIELD is a
  // label:value pair on ONE logical row (e.g. "Position" | "Charge Nurse"),
  // repeated down a single flowing column — not two unrelated sections
  // placed beside each other. Reading order label-then-value per row is
  // exactly how a human reads it too.
  "public-record": true,
  // A 2-column CSS grid holds Education and Certifications side by side —
  // two DIFFERENT sections in the same visual row, the exact shape that
  // risks interleaved extraction order.
  clinical: false,
  "critical-path": false,
  // Projects render as a 2-column masonry grid, and the footer is a 3-column
  // grid — both are real multi-column layouts, not incidental styling.
  "portfolio-grid": false,
  // The footer places Education and Certifications in a `flex flex-wrap`
  // row — two different sections side by side whenever there's room.
  pipeline: false,
  // Template library PR3 — every slug in CATALOG_TEMPLATE_CONFIGS gets its
  // ats_safe value straight from its own config's `atsSafe`, which is in
  // turn always its skeleton's own already-verified baseline (no config in
  // catalog-configs.ts restructures a skeleton's shape) — see that file's
  // header. Spread LAST so a config's real value always wins over nothing;
  // there is no per-slug manual value to disagree with it.
  ...Object.fromEntries(
    Object.entries(CATALOG_TEMPLATE_CONFIGS).map(([slug, config]) => [slug, config.atsSafe]),
  ),
};

/** Same fallback shape as `getTemplateComponent`: an unclassified/unknown slug is judged by whatever the fallback template actually renders. */
export function getTemplateAtsSafety(slug: string | null | undefined): boolean {
  if (!slug) return TEMPLATE_ATS_SAFETY[DEFAULT_TEMPLATE_SLUG];
  return TEMPLATE_ATS_SAFETY[slug] ?? TEMPLATE_ATS_SAFETY[DEFAULT_TEMPLATE_SLUG];
}
