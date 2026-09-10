import "server-only";
import { generateWithFailover } from "@/lib/llm";
import { FARAH_SYSTEM_PROMPT } from "@/lib/farah/system-prompt";
import type { StructuredResume } from "@/lib/resume/types";

/**
 * send-139's "AI-graded verification" — same shape as
 * scholarships/farah.ts's checkEligibility: reuses the existing LLMProvider
 * abstraction (src/lib/llm), no second LLM code path.
 *
 * WHAT IS BEING GRADED, stated plainly since the prompt itself doesn't spell
 * out a mechanism: the seeker's own base resume, for internal completeness
 * and consistency — dates that don't overlap or contradict, claims specific
 * enough to be checkable, no placeholder/lorem-ipsum content. This is NOT
 * fact-checking against any external source (no such source exists here) —
 * it is the same "grounded only in what's actually provided, mark unclear
 * rather than guess" discipline checkEligibility already uses, applied to
 * the resume itself rather than to a scholarship's stated criteria.
 */

export const VERIFICATION_PASS_THRESHOLD = 70;

export interface VerificationGrade {
  score: number;
  passed: boolean;
  feedback: string;
  concerns: string[];
}

const VERIFICATION_SCHEMA = {
  type: "object",
  properties: {
    score: {
      type: "integer",
      description: "0-100. How complete, specific, and internally consistent this resume is.",
    },
    feedback: {
      type: "string",
      description: "Two or three sentences, addressed to the person whose resume this is.",
    },
    concerns: {
      type: "array",
      items: { type: "string" },
      description:
        "Specific, concrete issues found (a date range that overlaps another job with no explanation, a bullet with no verifiable claim, missing dates) — empty if none.",
    },
  },
  required: ["score", "feedback", "concerns"],
} as const;

export async function gradeResumeForVerification(resume: StructuredResume): Promise<VerificationGrade> {
  const raw = await generateWithFailover((provider) =>
    provider.generateText({
      systemPrompt: FARAH_SYSTEM_PROMPT,
      turns: [
        {
          role: "user",
          content: `Grade this resume for a skills-verification badge on a job platform. This is NOT a fact-check against any outside source — you only have the resume itself. Score how COMPLETE, SPECIFIC, and INTERNALLY CONSISTENT it is: are dates coherent (no unexplained overlaps or gaps presented as continuous employment), are claims concrete enough to mean something (not just "worked on various projects"), is there enough real content to grade at all.

Be conservative — this badge tells employers something, so an empty or vague resume should score low. Do not invent or assume anything not present in the resume.

RESUME (JSON):
${JSON.stringify(resume).slice(0, 8000)}`,
        },
      ],
      maxOutputTokens: 1024,
      jsonSchema: VERIFICATION_SCHEMA as unknown as Record<string, unknown>,
    }),
  );

  const parsed = JSON.parse(raw) as { score?: number; feedback?: string; concerns?: string[] };
  const score = Math.max(0, Math.min(100, Math.round(parsed.score ?? 0)));
  return {
    score,
    passed: score >= VERIFICATION_PASS_THRESHOLD,
    feedback: parsed.feedback ?? "",
    concerns: Array.isArray(parsed.concerns) ? parsed.concerns : [],
  };
}
