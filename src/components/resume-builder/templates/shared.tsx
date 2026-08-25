import type { StructuredResume } from "@/lib/resume/types";

/**
 * Every template takes exactly this prop — the same one `ResumeDocument`
 * already took. Templates differ in LAYOUT, DENSITY and TYPOGRAPHY only; none
 * of them changes what a resume stores. A resume saved under one template
 * renders unchanged under any other, which is what makes switching template a
 * safe, reversible choice rather than a data migration.
 *
 * This is also how Resume-Now and Enhancv actually differentiate — style, not
 * a different data model per industry — so it is not a shortcut.
 */
export interface TemplateProps {
  resume: StructuredResume;
}

/** Joins the parts of a date range that are actually present. */
export function dateRange(start?: string, end?: string): string {
  return [start, end].filter(Boolean).join(" – ");
}

/** Contact line, shared because every template needs it and none styles the
 *  separator differently enough to justify a copy. */
export function contactLine(contact: StructuredResume["contact"]): string {
  return [contact.email, contact.phone, contact.location].filter(Boolean).join(" · ");
}
