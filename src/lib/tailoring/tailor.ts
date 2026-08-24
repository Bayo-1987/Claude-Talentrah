import "server-only";
import { getGeminiClient, GEMINI_MODEL, THINKING_CONFIG } from "@/lib/farah/client";
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

async function callGeminiRaw(
  baseResume: StructuredResume,
  jdText: string,
  includeCoverLetter: boolean,
): Promise<string> {
  const client = getGeminiClient();

  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Here is my base resume as JSON:\n${JSON.stringify(baseResume)}\n\nHere is the job description I want to tailor it to:\n${jdText.slice(0, 8000)}\n\n${includeCoverLetter ? "Include a cover letter." : "Do not include a cover letter."}`,
          },
        ],
      },
    ],
    config: {
      systemInstruction: FARAH_SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: TAILOR_RESPONSE_SCHEMA,
      maxOutputTokens: 4096,
      thinkingConfig: THINKING_CONFIG,
    },
  });

  const text = response.text;
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
  const text = await callGeminiRaw(baseResume, jdText, includeCoverLetter);

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
  };
}
