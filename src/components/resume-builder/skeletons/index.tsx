import type { ComponentType } from "react";
import type { StructuredResume } from "@/lib/resume/types";
import { SingleColumnSkeleton } from "./single-column";
import { SidebarLeftSkeleton } from "./sidebar-left";
import { RailRightSkeleton } from "./rail-right";
import { HeaderBandSkeleton } from "./header-band";
import { TimelineSkeleton } from "./timeline";
import { CompactDenseSkeleton } from "./compact-dense";
import { GridModulesSkeleton } from "./grid-modules";
import type { SkeletonKey, SkeletonProps, TemplateConfig } from "./types";

export type { TemplateConfig, StyleTokens, ContentConfig, SkeletonKey, SectionKey } from "./types";
export { CLEAN_PROFESSIONAL_CONFIG, DEMO_CONFIGS } from "./configs";
export { CATALOG_TEMPLATE_CONFIGS } from "./catalog-configs";

/** The seven skeletons, each written once. Every skeleton takes the same `SkeletonProps` — `{ resume, config }`. */
export const SKELETONS: Record<SkeletonKey, ComponentType<SkeletonProps>> = {
  "single-column": SingleColumnSkeleton,
  "sidebar-left": SidebarLeftSkeleton,
  "rail-right": RailRightSkeleton,
  "header-band": HeaderBandSkeleton,
  timeline: TimelineSkeleton,
  "compact-dense": CompactDenseSkeleton,
  "grid-modules": GridModulesSkeleton,
};

/** Render a `TemplateConfig` against a resume — the function PR3's DB-driven rows are expected to call once `structure_schema` is the live source of a row's config, rather than a source-level constant. */
export function renderTemplateConfig(config: TemplateConfig, resume: StructuredResume) {
  const Skeleton = SKELETONS[config.skeleton];
  return <Skeleton resume={resume} config={config} />;
}

/**
 * Turns a `TemplateConfig` into a `ComponentType<{ resume }>` — the shape
 * `templates/index.tsx`'s registry needs. This is what keeps
 * `getTemplateComponent(slug)` synchronous and DB-free: a configured
 * template's "component" is just this factory closing over its config, not a
 * different code path from a bespoke one.
 */
export function createConfiguredTemplateComponent(
  config: TemplateConfig,
): ComponentType<{ resume: StructuredResume }> {
  function ConfiguredTemplate({ resume }: { resume: StructuredResume }) {
    return renderTemplateConfig(config, resume);
  }
  return ConfiguredTemplate;
}
