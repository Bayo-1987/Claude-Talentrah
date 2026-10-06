import { formatDate } from "@/lib/format/datetime";

/**
 * What the Talent Directory badge says (VERIFY-1 Phase 0a). The old badge said "Verified — 87/100". What it stood for: Farah (or one mentor) read the resume for
 * completeness and consistency. Nothing checks identity, employment history or skills. So the badge says what was done, and never shows a score to an employer.
 *
 * WHICH REVIEWER comes from the database (0234): the review_type recorded on the candidate's latest passed review, 'ai' (Farah) or 'human' (a mentor). It is
 * never worked out from a score. A value the database did not give (no passed review row to read it from) is "unknown": the badge says "Resume reviewed" and
 * names no reviewer.
 */
export type ReviewMethod = "ai" | "mentor" | "unknown";

export function reviewMethodFromType(type: string | null | undefined): ReviewMethod {
  if (type === "ai") return "ai";
  if (type === "human") return "mentor";
  return "unknown";
}

/**
 * Which review an applicant's resume has, if any, for the applicant list. The database tells an employer only "verified" (a review that passed) or nothing (null) for
 * the status, and a type only for a verified profile: a pending, rejected or unreviewed profile arrives as null and shows nothing, never a partial result.
 */
export function resumeReviewFor(status: string | null | undefined, type: string | null | undefined): ReviewMethod | null {
  return status === "verified" ? reviewMethodFromType(type) : null;
}

const WHO: Record<ReviewMethod, string> = {
  ai: "Resume reviewed by Farah (AI)",
  mentor: "Resume reviewed by a Talentrah mentor",
  unknown: "Resume reviewed",
};

/** "Resume reviewed by Farah (AI) · 5 Oct 2026". With no date, or one that cannot be read, the same words and nothing after them. */
export function reviewedBadgeText(method: ReviewMethod, reviewedAt?: string | null): string {
  const date = reviewedAt ? formatDate(reviewedAt) : "";
  return date ? `${WHO[method]} · ${date}` : WHO[method];
}

/** What the badge means, said once and used everywhere it is shown. The owner's words. */
export const RESUME_REVIEW_MEANING = "We checked that the resume is complete, specific and consistent. We did not check identity, employment history or skills.";

/** The public page that says plainly what is checked today and what is not. */
export const HOW_WE_REVIEW_PATH = "/how-we-review-resumes";
