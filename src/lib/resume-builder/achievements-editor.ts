import { getExperienceBullets, type ResumeExperienceEntry } from "@/lib/resume/types";

/**
 * The rules behind the resume editor's Achievements field, kept out of
 * resume-editor.tsx so they can be unit-tested (TipTap does not render in the
 * node test environment).
 *
 * The field is paragraph-per-bullet: each editor paragraph IS one achievement
 * (minimal-rich-editor-list.tsx), so two or more paragraphs are always a
 * bulleted list. What the paragraphs cannot say is whether a role with ONE
 * achievement prints as a one-item list or as a prose line — that is what the
 * "Bulleted list" control decides, and it is stored the only way it can be
 * without a schema change: `bullets` present means a list.
 */

/**
 * The rich editor's display value for an entry: one array entry per top-level
 * editor paragraph, seeded from `bullets` when they exist (including a
 * description that is really a typed list, markers removed), falling back to a
 * single-paragraph array holding `description` otherwise, or an empty array for
 * a brand-new entry (which MinimalRichEditorList renders as one empty
 * paragraph). Mirrors `getExperienceText`'s precedence, shaped as an array
 * because the array IS the editor's own paragraph boundaries — no join step
 * for a keystroke to desync from.
 */
export function experienceBulletParagraphs(entry: ResumeExperienceEntry): string[] {
  const bullets = getExperienceBullets(entry);
  if (bullets) return bullets;
  return entry.description ? [entry.description] : [];
}

/**
 * The patch to apply to an entry for the editor's current paragraphs.
 *
 * `bullets` is set once there are two or more non-blank paragraphs, or one
 * when `bulleted` is on (the list control); otherwise a single paragraph stays
 * plain text rather than becoming a one-item list nobody asked for.
 * `description` always gets a plain-text fallback (the achievements joined with
 * a space, matching `getExperienceText`'s convention) so anything still reading
 * `.description` directly stays consistent.
 */
export function bulletsPatch(
  paragraphs: string[],
  bulleted: boolean,
): { description: string; bullets: string[] | undefined } {
  const nonBlank = paragraphs.map((p) => p.trim()).filter((p) => p.length > 0);
  return {
    description: nonBlank.join(" "),
    bullets: nonBlank.length > 1 || (bulleted && nonBlank.length > 0) ? nonBlank : undefined,
  };
}

/**
 * Whether the bulleted-list control may be switched OFF. With two or more
 * achievements each paragraph is its own bullet and there is no prose form to
 * return to without merging them into one string — which is exactly what the
 * tailoring pipeline and this editor must never do — so the control is locked
 * on until only one is left.
 */
export function canTurnOffBullets(paragraphs: string[]): boolean {
  return paragraphs.filter((p) => p.trim().length > 0).length <= 1;
}
