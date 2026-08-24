import type { StructuredResume } from "@/lib/resume/types";

export interface StructuredJdForTailoring {
  title?: string;
  seniority?: string;
  company?: string;
  skills: string[];
  keywords: string[];
  responsibilities: string[];
}

export interface GapAnalysisItem {
  keyword: string;
  status: "matched" | "missing";
  note?: string;
}

/**
 * Set when the pasted JD was longer than the cap and only its opening
 * portion reached the model. Null on every normal run.
 *
 * This exists so truncation can never be silent again: a shortened JD
 * produces a weaker tailoring result, and without saying so the user reads
 * that as the product being bad rather than as us having dropped half their
 * input.
 */
export interface JdTruncation {
  originalChars: number;
  usedChars: number;
}

export interface TailoringResult {
  structuredJd: StructuredJdForTailoring;
  gapAnalysis: GapAnalysisItem[];
  tailoredResume: StructuredResume;
  coverLetter: string | null;
  atsScore: number;
  atsFixes: string[];
  jdTruncation: JdTruncation | null;
}

/**
 * How much of a pasted job description reaches the model.
 *
 * Lives in this module rather than tailor.ts so tests and tooling can read
 * it without importing a "server-only" module — the value and reasoning are
 * unchanged.
 *
 * Was 8,000 with no recorded reason anywhere — not in the commit that
 * introduced it (M5), not in a comment, not in the plan doc or build
 * prompt. It was written when the planned provider was Anthropic Claude and
 * survived two provider migrations untouched, so whatever sized it no
 * longer describes the models actually in use.
 *
 * 24,000 is sized from two real bounds rather than picked as a round number:
 *
 *  1. Product reality. Across the 140 ingested postings: median 4,909
 *     chars, p95 8,488, p99 11,163, longest 20,805. The old cap truncated
 *     18 of those 140 — roughly one job description in eight, which is not
 *     an edge case. 24,000 clears the longest real posting with ~15% room.
 *
 *  2. Model headroom, against the *tighter* of the two providers. Groq's
 *     gpt-oss-120b has a 131,072-token window (confirmed from its own
 *     /models endpoint); Gemini 3.6 Flash has ~1,048,576. 24,000 chars is
 *     roughly 6,000 tokens — about 5% of the usable Groq budget after
 *     reserving the 4,096 output tokens and prompt overhead. Nowhere near
 *     either limit.
 *
 * Deliberately not "as much as the model allows": an unbounded paste is a
 * real cost tail (a novel-length input would push a single ₦750 tailoring
 * run toward ₦120 of spend). This keeps the worst case above 97% margin
 * while comfortably covering every genuine JD.
 *
 * If this changes again, update the reasoning with it — the whole problem
 * was a bare number nobody could justify.
 */
export const JD_MAX_CHARS = 24_000;
