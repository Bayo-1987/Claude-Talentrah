import { formatDate } from "@/lib/format/datetime";

/**
 * What the Talent Directory badge says (VERIFY-1 Phase 0a). The old badge said "Verified — 87/100". What it stood for: Farah (or one mentor) read the resume for
 * completeness and consistency. Nothing checks identity, employment history or skills. So the badge says what was done, and never shows a score to an employer.
 *
 * WHICH REVIEWER, from the stored score. An AI review always stores a score, and a mentor review never does (null), so for a profile that is verified the score
 * says which it was: tests/talent-directory/review-method-proof.test.ts proves it from the code (the grader cannot return a pass without a number; the mentor
 * runner passes null; those are the only two writers). A value that is missing altogether, rather than stored null, is "unknown": it gets no method.
 * Phase 0a-2 replaces this inference with the review_type the database already records.
 */
export type ReviewMethod = "ai" | "mentor" | "unknown";

export function reviewMethodFromScore(score: number | null | undefined): ReviewMethod {
  if (score === null) return "mentor";
  if (typeof score === "number" && Number.isFinite(score)) return "ai";
  return "unknown";
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
