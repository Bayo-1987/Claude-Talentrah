/** Shared fixtures for the applicants-list evidence line: one applicant row per case, everything but the score and the explanation fixed. */
import type { MatchExplanation } from "@/lib/matching/score";

export const explanationOf = (matched: number, missing: number, seniority: MatchExplanation["seniorityAlignment"] = "match"): MatchExplanation => ({
  matchedSkills: Array.from({ length: matched }, (_, i) => `skill-m${i}`),
  missingSkills: Array.from({ length: missing }, (_, i) => `skill-x${i}`),
  seniorityAlignment: seniority,
});

export function evidenceRow(score: number | null, explanation: unknown) {
  return {
    application_id: "11111111-1111-1111-1111-111111111111",
    first_name: "Test",
    last_name: "Applicant",
    applied_at: "2026-01-01T00:00:00Z",
    match_score: score,
    resume_id: null,
    status: "applied",
    explanation,
    resumeReview: null,
    resumeReviewedAt: null,
    screeningPassed: null,
  };
}

/** Cases whose markup must be byte-for-byte what it was before the evidence line existed: 60 and above, and every row with nothing honest to add. */
export const EVIDENCE_CASES: Record<string, { score: number | null; explanation: unknown }> = {
  "score 60 with an explanation": { score: 60, explanation: explanationOf(2, 3) },
  "score 85 with an explanation": { score: 85, explanation: explanationOf(8, 2) },
  "score 99 thin excellent": { score: 99, explanation: explanationOf(1, 0) },
  "score 59 with NO explanation (null)": { score: 59, explanation: null },
  "score 5 with NO explanation (null)": { score: 5, explanation: null },
  "score 5 on a job with no listed skills": { score: 5, explanation: explanationOf(0, 0) },
  "score 5 thin set: 0 of 1 tag": { score: 5, explanation: explanationOf(0, 1) },
  "score 30 thin set: 1 of 1 tag": { score: 30, explanation: explanationOf(1, 0) },
  "score 5 thin set: 0 of 2 tags": { score: 5, explanation: explanationOf(0, 2) },
  "score 59 thin set: 1 of 2 tags": { score: 59, explanation: explanationOf(1, 1) },
  "score null (not yet scored)": { score: null, explanation: null },
};
