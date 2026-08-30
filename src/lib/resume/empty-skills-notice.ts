/**
 * Whether to tell this user their resume has no skills on it (#145).
 *
 * Extracted from the Resume Builder page so the decision is testable on its
 * own. The page is a server component and the interesting part is not the
 * markup — it is which of several near-miss states counts as "empty", and each
 * of those is a real row shape that exists in production.
 */

/** The shape this reads out of `resumes.structured_content`, which is jsonb. */
export interface BaseResumeForNotice {
  id: string;
  structured_content: unknown;
}

/**
 * GATED ON THE SKILLS ARRAY, NOT ON `parse_confidence`.
 *
 * 0070 records a `low` confidence and gating on it would be the obvious
 * choice. It is the wrong one twice over:
 *
 *   1. Confidence drops to `low` when only the EMAIL is missing, which costs
 *      the user nothing — matching never reads it. A notice that fires on
 *      harmless cases is one people learn to ignore.
 *   2. Every row written before 0070 has `parse_confidence = null`, meaning
 *      "never recorded" rather than "fine" — and the one production account
 *      this exists for is one of those rows. A check against the column would
 *      have had to special-case null, and getting that backwards would skip
 *      precisely the user it is for.
 *
 * The skills array is present on every row, old and new, and is the thing
 * scoring actually divides against. Reading it removes the whole question.
 *
 * TREATS MISSING, NULL AND NON-ARRAY AS EMPTY. `structured_content` is jsonb
 * with no schema enforcement and the oldest rows predate the current shape;
 * all three states mean the same thing to `computeMatchScore` — nothing to
 * score against — so they mean the same thing here.
 */
export function shouldShowEmptySkillsNotice(
  baseResume: BaseResumeForNotice | null | undefined,
  dismissedAt: string | null | undefined,
): boolean {
  // No base resume is a different problem with a different fix (upload one),
  // and onboarding already owns it. Claiming their resume has no skills when
  // they have no resume would be false.
  if (!baseResume) return false;

  if (dismissedAt) return false;

  const skills = (baseResume.structured_content as { skills?: unknown } | null)?.skills;
  return !Array.isArray(skills) || skills.length === 0;
}
