import "server-only";
import { getGeminiClient, GEMINI_MODEL, THINKING_CONFIG } from "@/lib/farah/client";
import { EMPTY_RESUME, type StructuredResume } from "./types";
import { sanitizeStructuredResume, wasDegenerate } from "./sanitize";

// See the identical constant in src/lib/tailoring/tailor.ts for why this
// exists — a real, reproducible degenerate-output failure caught live.
const OPTIONAL_FIELD_NOTE =
  'Use "" (empty string) if the source doesn\'t provide this — never write an explanation, placeholder, or apology in place of a real value.';

const EXTRACTION_SCHEMA = {
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

async function callGeminiRaw(rawText: string): Promise<string> {
  const client = getGeminiClient();

  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Extract structured fields from this resume text. Leave fields empty/omitted rather than guessing when the text doesn't clearly say so.\n\n---\n${rawText.slice(0, 15000)}`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: EXTRACTION_SCHEMA,
      maxOutputTokens: 2048,
      thinkingConfig: THINKING_CONFIG,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini did not return structured resume data.");
  }
  return text;
}

interface ExtractionAttempt {
  resume: StructuredResume;
  bad: boolean;
}

async function attemptExtraction(rawText: string): Promise<ExtractionAttempt | null> {
  const text = await callGeminiRaw(rawText);

  let parsed: Partial<StructuredResume>;
  try {
    parsed = JSON.parse(text) as Partial<StructuredResume>;
  } catch {
    // Truncated/invalid JSON — same severe case wasDegenerate() can't catch
    // because there's no value to sanitize yet. Caller retries.
    return null;
  }

  const raw: StructuredResume = {
    ...EMPTY_RESUME,
    ...parsed,
    contact: { ...EMPTY_RESUME.contact, ...parsed.contact },
  };
  const resume = sanitizeStructuredResume(raw);
  return { resume, bad: wasDegenerate(raw, resume) };
}

/**
 * Only runs when the heuristic parser (heuristic-parse.ts) came back
 * low-confidence — this is the fallback path, not the primary one, per the
 * plan doc's "library/rules-first, LLM only for messy cases" decision.
 *
 * Same intermittent degenerate-output failure mode as tailoring — one
 * retry is enough in practice; sanitizeStructuredResume is the backstop
 * either way. See src/lib/tailoring/tailor.ts for the fuller note.
 */
export async function parseResumeWithGemini(
  rawText: string,
): Promise<StructuredResume> {
  let attempt = await attemptExtraction(rawText);
  if (!attempt || attempt.bad) {
    const retry = await attemptExtraction(rawText);
    if (retry && (!attempt || !retry.bad)) {
      attempt = retry;
    }
  }

  if (!attempt) {
    throw new Error("Gemini did not return structured resume data.");
  }
  return attempt.resume;
}
