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
