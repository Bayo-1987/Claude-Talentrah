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

/**
 * Something Farah found that would strengthen the tailored resume but isn't
 * already true of the candidate's base resume — a fabrication candidate,
 * reframed as a decision instead of a silent edit. See
 * src/lib/tailoring/grounding.ts's own header for the full incident this
 * exists to prevent.
 *
 * `source` is informational only, for the curious — the review UI treats a
 * model-declared proposal and a backstop-caught one identically. Neither
 * ever reaches `tailoredResume` without a separate, explicit accept.
 */
export interface ProposedAddition {
  id: string;
  section: "skills" | "experience";
  /** Only set when section is "experience" — the index into tailoredResume.experience this would replace. */
  experienceIndex?: number;
  /** The exact text that would be added/restored if accepted. */
  text: string;
  /** Why Farah thinks it's worth considering — what in the JD it addresses. */
  reason: string;
  source: "model" | "backstop";
}

export interface TailoringResult {
  structuredJd: StructuredJdForTailoring;
  gapAnalysis: GapAnalysisItem[];
  tailoredResume: StructuredResume;
  coverLetter: string | null;
  atsScore: number;
  atsFixes: string[];
  proposedAdditions: ProposedAddition[];
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
