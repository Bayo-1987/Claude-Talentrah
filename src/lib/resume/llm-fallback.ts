import "server-only";
import { generateWithFailover } from "@/lib/llm";
import { EMPTY_RESUME, type StructuredResume } from "./types";
import { sanitizeStructuredResume, wasDegenerate } from "./sanitize";

// See the identical constant in src/lib/tailoring/tailor.ts for why this
// exists — a real, reproducible degenerate-output failure caught live.
const OPTIONAL_FIELD_NOTE =
  'Use "" (empty string) if the source doesn\'t provide this — never write an explanation, placeholder, or apology in place of a real value.';

// Applies to every new optional SECTION below (an array or a boolean, never
// a bare string field, so OPTIONAL_FIELD_NOTE's "" convention doesn't apply
// to it) — the array/absent-key equivalent of the same rule: leave it out
// entirely rather than inventing a plausible-looking entry. A resume that
// genuinely has no languages, awards, publications, volunteering or a
// references line should come back with that key simply missing, not an
// empty-but-present array manufactured to look thorough.
const OPTIONAL_SECTION_NOTE =
  "Only include this when the resume text actually contains it. Omit the field entirely rather than inventing an entry — an empty or fabricated section is worse than a missing one.";

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
          bullets: {
            type: "array",
            items: { type: "string" },
            description:
              "Set this INSTEAD OF description when the source lists this role's responsibilities/achievements as separate bullet points — one array entry per bullet, exactly as written, not a summary of them. Leave both bullets and description out if the source only has a role title with nothing further said about it. Never populate both for the same entry.",
          },
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
    links: {
      type: "array",
      description:
        `${OPTIONAL_SECTION_NOTE} A LinkedIn/GitHub/portfolio URL, or a "see my work at ..." line, becomes one entry each — label it by what it actually is (e.g. "LinkedIn", "GitHub", "Portfolio"), never a generic placeholder.`,
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          url: { type: "string" },
        },
        required: ["label", "url"],
      },
    },
    languages: {
      type: "array",
      description: `${OPTIONAL_SECTION_NOTE} "level" is only the proficiency the source itself states (e.g. "Fluent", "Native", "B2") — never inferred from the language alone.`,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          level: { type: "string", description: OPTIONAL_FIELD_NOTE },
        },
        required: ["name"],
      },
    },
    awards: {
      type: "array",
      items: { type: "string" },
      description: `${OPTIONAL_SECTION_NOTE} One award/honour per entry, as named in the source.`,
    },
    publications: {
      type: "array",
      items: { type: "string" },
      description: `${OPTIONAL_SECTION_NOTE} One publication per entry, as cited in the source.`,
    },
    volunteering: {
      type: "array",
      description: `${OPTIONAL_SECTION_NOTE} Only for a section the source clearly labels as volunteer/unpaid work — do not move a paid role here, and do not duplicate it from "experience".`,
      items: {
        type: "object",
        properties: {
          role: { type: "string" },
          organisation: { type: "string" },
          startDate: { type: "string", description: OPTIONAL_FIELD_NOTE },
          endDate: { type: "string", description: OPTIONAL_FIELD_NOTE },
          description: { type: "string", description: OPTIONAL_FIELD_NOTE },
        },
        required: ["role", "organisation"],
      },
    },
    customSections: {
      type: "array",
      description:
        `${OPTIONAL_SECTION_NOTE} For a real, clearly-titled section that doesn't fit any of the fields above (e.g. "Tech Stack", "Publications" already has its own field so don't duplicate here, "Open Source", "Impact") — use the source's own section title, and list its items exactly as written.`,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          items: { type: "array", items: { type: "string" } },
        },
        required: ["title", "items"],
      },
    },
    referencesOnRequest: {
      type: "boolean",
      description:
        'True ONLY if the source literally says something like "References available on request" or "References on request" — never inferred from the mere absence of a references section. Omit this field rather than setting it false.',
    },
  },
  required: ["contact", "experience", "education", "skills"],
};

async function callLLMRaw(rawText: string): Promise<string> {
  const text = await generateWithFailover((provider) =>
    provider.generateText({
      turns: [
        {
          role: "user",
          content: `Extract structured fields from this resume text. Leave fields empty/omitted rather than guessing when the text doesn't clearly say so.\n\n---\n${rawText.slice(0, 15000)}`,
        },
      ],
      maxOutputTokens: 2048,
      jsonSchema: EXTRACTION_SCHEMA,
    }),
  );

  if (!text) {
    throw new Error("The LLM fallback did not return structured resume data.");
  }
  return text;
}

interface ExtractionAttempt {
  resume: StructuredResume;
  bad: boolean;
}

async function attemptExtraction(rawText: string): Promise<ExtractionAttempt | null> {
  const text = await callLLMRaw(rawText);

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
export async function parseResumeWithLLM(
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
    throw new Error("The LLM fallback did not return structured resume data.");
  }
  return attempt.resume;
}
