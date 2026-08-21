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

export interface TailoringResult {
  structuredJd: StructuredJdForTailoring;
  gapAnalysis: GapAnalysisItem[];
  tailoredResume: StructuredResume;
  coverLetter: string | null;
  atsScore: number;
  atsFixes: string[];
}
