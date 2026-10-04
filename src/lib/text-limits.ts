/**
 * Caps on free text (S1-56): one table, one rule, used by the client (counter, maxLength) and the server (the action's own check).
 *
 * APP-LEVEL ONLY: no database constraint and no migration. The numbers sit above the longest value in production when they were chosen.
 * `fitsLimit` counts the way the server counts (trimmed UTF-16 length) and never locks a person out of text they already saved: a value
 * that was over the cap before it existed may be saved unchanged or made shorter, only not longer.
 */
export const FIELD_LIMITS = {
  reportDetails: 2000,
  feedbackMessage: 5000,
  contactMessage: 5000,
  trackerNotes: 2000,
  mentorshipReviewNote: 1000,
  assessmentTextAnswer: 5000,
  scholarshipMotivation: 2000,
  portfolioDescription: 1000,
  contactRequestMessage: 2000,
  companyDescription: 1000,
  mentorBio: 2000,
  decisionNote: 2000,
  /** Not a block: the tailoring prompt reads only this many characters of a pasted job description (JD_MAX_CHARS). */
  jdPasteUsedChars: 24000,
} as const;

/**
 * The length the server compares against a cap: trimmed, in UTF-16 code units. A line break is ONE character, the way the box counts it:
 * a real form post turns every line break into CRLF (two characters), so counting the posted bytes would refuse text the box allowed.
 */
export function countForLimit(value: string): number {
  return value.replace(/\r\n/g, "\n").trim().length;
}

/**
 * Whether `next` is acceptable for a field capped at `limit`. When `existing` (the value already saved) is over the cap, anything no
 * longer than it is still acceptable, so saving unchanged or shortening always works and only adding more is refused.
 */
export function fitsLimit(next: string, limit: number, existing?: string): boolean {
  const allowed = Math.max(limit, existing === undefined ? 0 : countForLimit(existing));
  return countForLimit(next) <= allowed;
}
