import "server-only";
import { getLLMProvider } from "@/lib/llm";
import { FARAH_SYSTEM_PROMPT } from "@/lib/farah/system-prompt";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { sanitizeStructuredResume, wasDegenerate } from "@/lib/resume/sanitize";
import { applyGroundingBackstop } from "./grounding";
import { JD_MAX_CHARS, type ProposedAddition, type TailoringResult } from "./types";

export { JD_MAX_CHARS };

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
    skills: {
      type: "array",
      items: { type: "string" },
      description:
        "Reorder to put the most relevant-to-this-JD skills first, but keep every real skill from the base resume unless it's a genuine duplicate — dropping a truthful skill because it doesn't match THIS job hides real information from the candidate's own resume. Never add a skill that isn't already on the base resume.",
    },
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
        "The candidate's base resume, rewritten to emphasize what this specific JD asks for, using ONLY facts already present in the base resume. Reprioritize, reorder, and rephrase freely — but every skill, every sentence in every experience description, and the summary must already be true of this candidate based on their base resume. NEVER add a skill, tool, responsibility, or achievement that is not already there, even one that would be a strong match for this job — including something you infer is 'probably' true given their role. A gap belongs in gapAnalysis and proposedAdditions, never silently written into this field. This field is saved and shown to the candidate as their real resume without a further review step, so anything invented here reaches them as a false claim under their own name.",
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
      description:
        "2-5 short, specific, actionable fixes for the CANDIDATE to consider — e.g. \"add 'stakeholder management' — appears 3x in this JD, 0x in your resume\". These are suggestions for a human to read and decide on, never instructions to apply to tailoredResume yourself. If a fix would add a new skill or a new claim about their experience, also add a matching entry to proposedAdditions with the exact text — don't leave it as a suggestion with nothing structured behind it.",
    },
    proposedAdditions: {
      type: "array",
      description:
        "Anything you considered adding to strengthen the match but that ISN'T already grounded in the base resume — skills the JD wants that the candidate hasn't listed, or a specific claim about a role that would help but isn't already there. Every one of these is shown to the candidate as an explicit opt-in choice, never written into tailoredResume automatically. When in doubt about whether something counts as 'already grounded,' put it here rather than in tailoredResume — the safe failure mode is asking the candidate, not guessing on their behalf.",
      items: {
        type: "object",
        properties: {
          section: { type: "string", enum: ["skills", "experience"] },
          experienceIndex: {
            type: "integer",
            description: "Only set when section is \"experience\" — the index into tailoredResume.experience this claim is about.",
          },
          text: {
            type: "string",
            description:
              "For section \"skills\": the exact skill string to add. For section \"experience\": the FULL replacement description for that entry if accepted — not just a clause to append, the complete text that entry's description would become. Accepting an item always replaces, never appends, so this must stand alone as the whole description.",
          },
          reason: { type: "string", description: "One short sentence: what in the JD this addresses." },
        },
        required: ["section", "text", "reason"],
      },
    },
  },
  required: ["structuredJd", "gapAnalysis", "tailoredResume", "atsScore", "atsFixes", "proposedAdditions"],
};

/**
 * Carries every field this PR's schema widening added onto the tailored
 * resume, UNCHANGED from the base resume — this run's LLM schema was not
 * touched to ask the model to rewrite them, so nothing in `input.tailoredResume`
 * or `EMPTY_RESUME` provides them, and without this they would simply
 * vanish the moment a resume with any of them went through tailoring.
 * "Preserve, don't (yet) tailor" is deliberate scope for this PR — see the
 * template library milestone notes.
 *
 * Per-entry `bullets` needs its own pass rather than a flat spread, because
 * it lives on `experience[i]`, not at the top level, and the tailored
 * experience array is model output — same content, same order in the
 * overwhelming common case, but matched by title+company (the same
 * matching `groundExperienceDescriptions` already uses) rather than assumed
 * to line up index-for-index.
 */
function preserveNewFields(
  tailoredResume: StructuredResume,
  baseResume: StructuredResume,
): StructuredResume {
  const sameRole = (title: string, company: string, base: { title: string; company: string }) =>
    title.trim().toLowerCase() === base.title.trim().toLowerCase() &&
    company.trim().toLowerCase() === base.company.trim().toLowerCase();

  const experience = tailoredResume.experience.map((entry) => {
    const baseEntry = baseResume.experience.find((b) => sameRole(entry.title, entry.company, b));
    return baseEntry?.bullets ? { ...entry, bullets: baseEntry.bullets } : entry;
  });

  return {
    ...tailoredResume,
    experience,
    links: baseResume.links,
    languages: baseResume.languages,
    awards: baseResume.awards,
    publications: baseResume.publications,
    volunteering: baseResume.volunteering,
    customSections: baseResume.customSections,
    referencesOnRequest: baseResume.referencesOnRequest,
  };
}

interface RawProposedAddition {
  section: "skills" | "experience";
  experienceIndex?: number;
  text: string;
  reason: string;
}

interface RawTailoringInput {
  structuredJd: TailoringResult["structuredJd"];
  gapAnalysis: TailoringResult["gapAnalysis"];
  tailoredResume: Partial<StructuredResume>;
  coverLetter?: string;
  atsScore: number;
  atsFixes: string[];
  proposedAdditions?: RawProposedAddition[];
}

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

  /*
   * THE BACKSTOP RUNS UNCONDITIONALLY, REGARDLESS OF WHETHER THE MODEL
   * DECLARED ANY proposedAdditions ITSELF. The schema and prompt above ask
   * the model to self-report additions rather than inline them — but a
   * model already inclined to inline a fabrication for a higher atsScore
   * has no particular incentive to also declare it honestly in a separate
   * field it could just as easily skip. This is what makes "never reaches
   * the resume automatically" true regardless of model behaviour, not just
   * requested of it. See grounding.ts's own header for the full reasoning.
   */
  const { resume: backstopResume, additions: backstopAdditions } = applyGroundingBackstop(
    tailoredResume,
    baseResume,
    input.structuredJd ?? { skills: [], keywords: [], responsibilities: [] },
  );

  // See preserveNewFields' own header: this run's tailoring schema doesn't
  // ask the model about any of the fields added while widening the resume
  // schema, so they carry over from the base resume unchanged rather than
  // disappearing.
  const groundedResume = preserveNewFields(backstopResume, baseResume);

  let modelAdditionCounter = 0;
  const modelAdditions: ProposedAddition[] = (input.proposedAdditions ?? [])
    .filter(
      (a) =>
        a &&
        (a.section === "skills" || a.section === "experience") &&
        typeof a.text === "string" &&
        a.text.trim().length > 0 &&
        (a.section !== "experience" ||
          (typeof a.experienceIndex === "number" &&
            a.experienceIndex >= 0 &&
            a.experienceIndex < groundedResume.experience.length)),
    )
    .map((a) => {
      modelAdditionCounter += 1;
      return {
        id: `model-${modelAdditionCounter}`,
        section: a.section,
        experienceIndex: a.section === "experience" ? a.experienceIndex : undefined,
        text: a.text,
        reason: a.reason || "Farah flagged this as worth adding.",
        source: "model" as const,
      };
    });

  return {
    structuredJd: input.structuredJd,
    gapAnalysis: input.gapAnalysis ?? [],
    tailoredResume: groundedResume,
    coverLetter: includeCoverLetter ? (input.coverLetter ?? null) : null,
    atsScore: Math.max(0, Math.min(100, Math.round(input.atsScore ?? 0))),
    atsFixes: input.atsFixes ?? [],
    proposedAdditions: [...modelAdditions, ...backstopAdditions],
    jdTruncation,
  };
}
