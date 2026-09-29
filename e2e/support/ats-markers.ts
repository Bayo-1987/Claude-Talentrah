import type { SectionKey, TemplateConfig } from "@/components/resume-builder/skeletons/types";

/*
 * Marker bookkeeping shared by e2e/ats-safety.spec.ts and
 * e2e/print-button-fonts.spec.ts: which `ZQ…` marker each section of
 * `ATS_TEST_RESUME` carries, and the reading order / presence a config
 * should produce in extracted PDF text. Imports the type-only skeleton
 * shapes, never a skeleton component (those pull in `next/font/google`,
 * which only exists inside Next's own build).
 */

/**
 * Which marker(s) `ATS_TEST_RESUME` (src/lib/resume-builder/ats-test-fixture.ts)
 * carries for each section, IN THE ORDER THEY APPEAR WITHIN THAT SECTION —
 * e.g. an experience entry's title renders before its body text.
 */
export const SECTION_MARKERS: Partial<Record<SectionKey, string[]>> = {
  experience: ["ZQEXPERIENCE", "ZQEXPERIENCEBODY"],
  education: ["ZQEDUCATION"],
  skills: ["ZQSKILLS"],
  projects: ["ZQPROJECTS"],
  certifications: ["ZQCERTIFICATIONS"],
  links: ["ZQLINKS"],
  languages: ["ZQLANGUAGES"],
  awards: ["ZQAWARDS"],
};

/** The order a human reading THIS config's rendered page would encounter each marker — header name, then summary, then `content.sectionOrder` flattened through `SECTION_MARKERS`. Only correct for configs where `showLinksInHeader` is off, which is true of every skeleton this file asserts a strict order for (see the per-config comment below). */
export function expectedMarkerOrder(config: TemplateConfig): string[] {
  const markers: string[] = ["ZQNAME"];
  if (config.content.showSummary) markers.push("ZQSUMMARY");
  for (const key of config.content.sectionOrder) {
    markers.push(...(SECTION_MARKERS[key] ?? []));
  }
  return markers;
}

export function actualMarkerOrder(text: string, candidates: string[]): string[] {
  const present = candidates.filter((m) => text.includes(m));
  return [...present].sort((a, b) => text.indexOf(a) - text.indexOf(b));
}
