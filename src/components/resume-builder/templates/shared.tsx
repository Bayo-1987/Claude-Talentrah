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

/** From this many certifications up, a list goes into two compact columns. */
export const CERTIFICATION_TWO_COLUMN_MIN = 8;

/**
 * A long run of one-line certifications is the cheapest thing on a resume to
 * halve: eighteen of them in one column push a resume onto an extra page.
 * Given a list's SINGLE-column classes (which contain `flex flex-col`),
 * returns the same list as two columns once there are
 * `CERTIFICATION_TWO_COLUMN_MIN` or more — and unchanged below that, or in a
 * narrow column (a 200px sidebar or rail) where two columns would not fit.
 */
export function certificationListClass(
  count: number,
  singleColumnClass: string,
  { narrow = false }: { narrow?: boolean } = {},
): string {
  if (narrow || count < CERTIFICATION_TWO_COLUMN_MIN) return singleColumnClass;
  return singleColumnClass.replace("flex flex-col", "grid grid-cols-2 gap-x-6");
}

/** Contact line, shared because every template needs it and none styles the
 *  separator differently enough to justify a copy. */
export function contactLine(contact: StructuredResume["contact"]): string {
  return [contact.email, contact.phone, contact.location].filter(Boolean).join(" · ");
}
