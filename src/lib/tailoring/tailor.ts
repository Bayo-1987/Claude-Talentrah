import "server-only";
import { getLLMProvider } from "@/lib/llm";
import { FARAH_SYSTEM_PROMPT } from "@/lib/farah/system-prompt";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { sanitizeStructuredResume, wasDegenerate } from "@/lib/resume/sanitize";
import type { TailoringResult } from "./types";

// Applied to every optional field below. Observed live (gemini-3.6-flash):
// without this, a field the base resume simply doesn't have (e.g. no phone
// number) can make the model spiral into hundreds of words of repetitive
// filler instead of an empty string, consistently reproducible on the same
// missing field — not a rare fluke. sanitizeStructuredResume() is still the
// backstop, but fixing the prompt is what actually stops it happening.
const OPTIONAL_FIELD_NOTE =
  'Use "" (empty string) if the source doesn\'t provide this — never write an explanation, placeholder, or apology in place of a real value.';

const RESUME_SCHEMA = {
  type: "object",
  properties: {
    contact: {
      type: "object",
      properties: {
        name: { type: "string", description: OPTIONAL_FIELD_NOTE },
        email: { type: "string", description: OPTIONAL_FIELD_NOTE },
        phone: { type: "string", description: OPTIONAL_FIELD_NOTE },
        location: { type: "string", description: OPTIONAL_FIELD_NOTE },
      },
    },
    summary: { type: "string", description: OPTIONAL_FIELD_NOTE },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          company: { type: "string" },
          location: { type: "string", description: OPTIONAL_FIELD_NOTE },
          startDate: { type: "string", description: OPTIONAL_FIELD_NOTE },
          endDate: { type: "string", description: OPTIONAL_FIELD_NOTE },
          description: { type: "string", description: OPTIONAL_FIELD_NOTE },
        },
        required: ["title", "company"],
      },
    },
    education: {
      type: "array",
      items: {
        type: "object",
        properties: {
          school: { type: "string" },
          degree: { type: "string", description: OPTIONAL_FIELD_NOTE },
          field: { type: "string", description: OPTIONAL_FIELD_NOTE },
          startDate: { type: "string", description: OPTIONAL_FIELD_NOTE },
          endDate: { type: "string", description: OPTIONAL_FIELD_NOTE },
        },
        required: ["school"],
      },
    },
    skills: { type: "array", items: { type: "string" } },
    projects: { type: "array", items: { type: "string" } },
    certifications: { type: "array", items: { type: "string" } },
  },
  required: ["contact", "experience", "education", "skills"],
};

/**
 * Gemini's responseSchema accepts standard JSON Schema directly (the SDK
 * detects and forwards it as responseJsonSchema internally) — no need for
 * Anthropic's tool-use wrapper this used to be built as, just the shape of
 * the JSON we want back.
 */
const TAILOR_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    structuredJd: {
      type: "object",
      properties: {
        title: { type: "string" },
        seniority: { type: "string" },
        company: { type: "string" },
        skills: { type: "array", items: { type: "string" } },
        keywords: { type: "array", items: { type: "string" } },
        responsibilities: { type: "array", items: { type: "string" } },
      },
      required: ["skills", "keywords", "responsibilities"],
    },
    gapAnalysis: {
      type: "array",
      description:
        "One entry per important keyword/skill from the JD — whether the resume already covers it.",
      items: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          status: { type: "string", enum: ["matched", "missing"] },
          note: {
            type: "string",
            description: "Short, specific note — e.g. how many times it appears in the JD vs. resume.",
          },
        },
        required: ["keyword", "status"],
      },
    },
    tailoredResume: {
      ...RESUME_SCHEMA,
      description:
        "The candidate's base resume, rewritten to emphasize what this specific JD asks for. Do not invent experience that isn't in the base resume — rephrase and reprioritize what's genuinely there.",
    },
    coverLetter: {
      type: "string",
      description: "A short, specific cover letter (3-4 paragraphs), or omit this field entirely if not requested.",
    },
    atsScore: {
      type: "integer",
      description: "0-100 ATS compatibility score for the tailored resume against this JD.",
    },
    atsFixes: {
      type: "array",
      items: { type: "string" },
      description: "2-5 short, specific, actionable fixes — e.g. \"add 'stakeholder management' — appears 3x in this JD, 0x in your resume\".",
    },
  },
  required: ["structuredJd", "gapAnalysis", "tailoredResume", "atsScore", "atsFixes"],
};

interface RawTailoringInput {
  structuredJd: TailoringResult["structuredJd"];
  gapAnalysis: TailoringResult["gapAnalysis"];
  tailoredResume: Partial<StructuredResume>;
  coverLetter?: string;
  atsScore: number;
  atsFixes: string[];
}

/**
 * How much of a pasted job description reaches the model.
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

async function callLLMRaw(
  baseResume: StructuredResume,
  jdText: string,
  includeCoverLetter: boolean,
): Promise<string> {
  const text = await getLLMProvider().generateText({
    systemPrompt: FARAH_SYSTEM_PROMPT,
    turns: [
      {
        role: "user",
        content: `Here is my base resume as JSON:\n${JSON.stringify(baseResume)}\n\nHere is the job description I want to tailor it to:\n${jdText.slice(0, JD_MAX_CHARS)}\n\n${includeCoverLetter ? "Include a cover letter." : "Do not include a cover letter."}`,
      },
    ],
    maxOutputTokens: 4096,
    jsonSchema: TAILOR_RESPONSE_SCHEMA,
  });

  if (!text) {
    throw new Error("Farah didn't return a structured tailoring result.");
  }
  return text;
}

interface TailoringAttempt {
  input: RawTailoringInput;
  tailoredResume: StructuredResume;
  /** True if the raw JSON failed to parse (e.g. truncated mid-string) or a field had to be sanitized. */
  bad: boolean;
}

async function attemptTailoring(
  baseResume: StructuredResume,
  jdText: string,
  includeCoverLetter: boolean,
): Promise<TailoringAttempt | null> {
  const text = await callLLMRaw(baseResume, jdText, includeCoverLetter);

  let input: RawTailoringInput;
  try {
    input = JSON.parse(text) as RawTailoringInput;
  } catch {
    // Truncated/invalid JSON — the same degenerate-generation failure as
    // wasDegenerate() catches, just severe enough to break JSON structure
    // itself before we ever get a value to sanitize. Not retry-able within
    // this attempt; the caller retries the whole call.
    return null;
  }

  // Gemini's native responseSchema does real constrained decoding — a
  // missing required field can't happen. Groq's json_object mode only
  // guarantees valid JSON *syntax*, not schema compliance (confirmed
  // live: a real response parsed fine but omitted tailoredResume
  // entirely under token pressure) — so the same "not retry-able within
  // this attempt" treatment applies here too, not just to a parse failure.
  if (!input.tailoredResume || typeof input.tailoredResume !== "object") {
    return null;
  }

  const rawResume: StructuredResume = {
    ...EMPTY_RESUME,
    ...input.tailoredResume,
    contact: { ...EMPTY_RESUME.contact, ...input.tailoredResume.contact },
  };
  const tailoredResume = sanitizeStructuredResume(rawResume);
  return { input, tailoredResume, bad: wasDegenerate(rawResume, tailoredResume) };
}

export async function tailorResumeToJob(
  baseResume: StructuredResume,
  jdText: string,
  includeCoverLetter: boolean,
): Promise<TailoringResult> {
  // Observed live: this model occasionally spirals a missing/ambiguous
  // field into hundreds of words of repetitive filler instead of an empty
  // string — sometimes severely enough to run past maxOutputTokens and
  // break the JSON itself. That's intermittent, not config-fixable; one
  // retry is enough in practice. sanitizeStructuredResume is the backstop
  // either way (a still-bad retry is used anyway, just with degenerate
  // fields sanitized out, rather than failing the whole request).
  // Computed once here, from the caller's original text, so the notice
  // reflects what the user actually pasted rather than anything a retry saw.
  const jdTruncation =
    jdText.length > JD_MAX_CHARS
      ? { originalChars: jdText.length, usedChars: JD_MAX_CHARS }
      : null;

  let attempt = await attemptTailoring(baseResume, jdText, includeCoverLetter);
  if (!attempt || attempt.bad) {
    const retry = await attemptTailoring(baseResume, jdText, includeCoverLetter);
    if (retry && (!attempt || !retry.bad)) {
      attempt = retry;
    }
  }

  if (!attempt) {
    throw new Error("Farah couldn't put together a tailored resume that time — try again.");
  }

  const { input, tailoredResume } = attempt;
  return {
    structuredJd: input.structuredJd,
    gapAnalysis: input.gapAnalysis ?? [],
    tailoredResume,
    coverLetter: includeCoverLetter ? (input.coverLetter ?? null) : null,
    atsScore: Math.max(0, Math.min(100, Math.round(input.atsScore ?? 0))),
    atsFixes: input.atsFixes ?? [],
    jdTruncation,
  };
}
