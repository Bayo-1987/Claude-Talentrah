import "server-only";
import { generateWithFailover } from "@/lib/llm";
import { FARAH_SYSTEM_PROMPT } from "@/lib/farah/system-prompt";
import { Constants } from "@/lib/supabase/types";

/**
 * send-368 — "Draft with Farah": a single `jsonSchema`-constrained call that
 * drafts a job description (as structured sections, assembled into markdown
 * server-side — never the model's own free-form prose) plus two small,
 * explicitly-labeled SUGGESTIONS the employer reviews before anything saves.
 * Same well-precedented shape as farah-review.ts's 512-token call and
 * tailor.ts's 4096-token call — no new request-size guard needed;
 * token-budget.ts's ceilings are chat-specific by that file's own header.
 *
 * ── WHY SALARY AND LOCATION ARE NOT IN THIS SCHEMA AT ALL ──────────────────
 *
 * Salary is real financial information a candidate can rely on, shown to
 * seekers and included in the job's search listing data (CLAUDE.md) — the
 * one field on this form with actual monetary consequence if wrong.
 * Fabricating a number here is a materially different risk than a suggested
 * seniority badge or a draft bullet point, so it is never generated, not
 * even as a labeled suggestion. Location is not inferable from a title at
 * all (a "Growth Marketer" role says nothing about where it's based), and
 * inferWorkType (draft-job-action.ts) needs location as an INPUT, not an
 * output this schema could produce. Both stay employer-typed input only.
 *
 * ── WHY SENIORITY/WORK TYPE ARE NOT IN THIS SCHEMA EITHER ──────────────────
 *
 * inferSeniority(title) and inferWorkType(title, location) — the exact
 * functions the aggregation pipeline already uses for scraped postings that
 * lack them — answer these from the same inputs this LLM call already has,
 * with no LLM guess needed alongside a second, potentially disagreeing
 * answer. Called directly by draft-job-action.ts, not reimplemented or asked
 * of the model here.
 */
const DRAFT_JOB_SCHEMA = {
  type: "object",
  properties: {
    roleSummary: {
      type: "string",
      description:
        "One or two sentences introducing the role, in a plain, professional job-posting tone — no heading, no bullet formatting, no markdown at all, just prose. Do not invent a specific company name, product, or team unless the job title itself implies one.",
    },
    responsibilities: {
      type: "array",
      items: { type: "string" },
      description:
        "4-7 short, specific bullet points for a 'What you'll do' section — concrete, plausible day-to-day responsibilities for this exact title, not generic filler that could apply to any job.",
    },
    requirements: {
      type: "array",
      items: { type: "string" },
      description:
        "4-7 short, specific bullet points for a 'What we're looking for' section — skills, experience and qualifications a real candidate for this exact title would need.",
    },
    preferred: {
      type: "array",
      items: { type: "string" },
      description:
        "0-4 optional 'nice to have' bullet points, genuinely distinct from the requirements above — omit entirely (empty array) rather than padding this out with a restatement of something already listed as required.",
    },
    suggestedEmploymentType: {
      type: "string",
      enum: [...Constants.public.Enums.employment_type],
      description:
        "Your best guess at the employment type for this role, based only on the title. This is a SUGGESTION the employer reviews and can change with one click before anything saves — never state or imply it as a fact about a real posting.",
    },
    suggestedYearsExperienceMin: {
      type: "integer",
      description:
        "Your best guess at a plausible minimum years of experience for this exact title (0 for an entry-level, junior, intern or graduate role). A SUGGESTION, same caveat as suggestedEmploymentType.",
    },
  },
  required: [
    "roleSummary",
    "responsibilities",
    "requirements",
    "preferred",
    "suggestedEmploymentType",
    "suggestedYearsExperienceMin",
  ],
} as const;

interface RawDraftResponse {
  roleSummary?: unknown;
  responsibilities?: unknown;
  requirements?: unknown;
  preferred?: unknown;
  suggestedEmploymentType?: unknown;
  suggestedYearsExperienceMin?: unknown;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Exported for the round-trip test — assembles exactly the markdown subset
 * render-markdown.tsx's own `parseBlocks` grammar understands (`## heading`,
 * `- bullet`, blank-line-separated paragraphs), the same rule send-367's
 * rich editor documents in detail. This is why a section with zero bullets
 * is skipped entirely rather than emitted as an empty heading — parseBlocks
 * has no representation for "a heading with nothing under it" that would
 * round-trip cleanly back through the editor's own deserializer.
 */
export function assembleJobDescriptionMarkdown(sections: {
  roleSummary: string;
  responsibilities: string[];
  requirements: string[];
  preferred: string[];
}): string {
  const bulletsBlock = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

  const parts = [sections.roleSummary.trim()];
  if (sections.responsibilities.length > 0) {
    parts.push(`## What you'll do\n${bulletsBlock(sections.responsibilities)}`);
  }
  if (sections.requirements.length > 0) {
    parts.push(`## What we're looking for\n${bulletsBlock(sections.requirements)}`);
  }
  if (sections.preferred.length > 0) {
    parts.push(`## Preferred\n${bulletsBlock(sections.preferred)}`);
  }
  return parts.join("\n\n");
}

export interface JobDraftResult {
  description: string;
  /** Null when the model's own suggestion didn't match a real employment_type enum value — never guessed at by this function. */
  suggestedEmploymentType: string | null;
  /** Null when the model omitted it or returned something that isn't a non-negative integer. */
  suggestedYearsExperienceMin: number | null;
}

/**
 * The one LLM call. Throws on any failure (network, rate limit past
 * generateWithFailover's own one retry, unparsable JSON, a response missing
 * the fields this function itself needs to assemble a real description) —
 * the caller (draft-job-action.ts) is what reverses the ad-wallet charge on
 * a throw, so this function's only job is "produce a real result or throw,"
 * same division of responsibility farah-review.ts's gradeAnswer already
 * draws.
 */
export async function draftJobDescription(title: string, location: string | null): Promise<JobDraftResult> {
  const raw = await generateWithFailover((provider) =>
    provider.generateText({
      systemPrompt: FARAH_SYSTEM_PROMPT,
      turns: [
        {
          role: "user",
          content: `Draft a job posting for the role below, as if you were the hiring team writing it for a real job board — specific and concrete, never generic filler that could apply to any job.

Job title: ${title}
${location ? `Location: ${location}` : "Location: not specified yet."}

Ground everything only in what a real posting for this exact title would plausibly say. Do not invent a specific company name, product, team, or metric that isn't implied by the title itself.`,
        },
      ],
      maxOutputTokens: 1000,
      jsonSchema: DRAFT_JOB_SCHEMA as unknown as Record<string, unknown>,
    }),
  );

  const parsed = JSON.parse(raw) as RawDraftResponse;

  if (typeof parsed.roleSummary !== "string" || !parsed.roleSummary.trim()) {
    throw new Error("Farah's draft was missing a role summary.");
  }
  const responsibilities = stringArray(parsed.responsibilities);
  const requirements = stringArray(parsed.requirements);
  if (responsibilities.length === 0) {
    throw new Error("Farah's draft was missing responsibilities.");
  }
  if (requirements.length === 0) {
    throw new Error("Farah's draft was missing requirements.");
  }
  const preferred = stringArray(parsed.preferred);

  const description = assembleJobDescriptionMarkdown({
    roleSummary: parsed.roleSummary,
    responsibilities,
    requirements,
    preferred,
  });

  const employmentTypeValues: readonly string[] = Constants.public.Enums.employment_type;
  const suggestedEmploymentType =
    typeof parsed.suggestedEmploymentType === "string" &&
    employmentTypeValues.includes(parsed.suggestedEmploymentType)
      ? parsed.suggestedEmploymentType
      : null;

  const suggestedYearsExperienceMin =
    typeof parsed.suggestedYearsExperienceMin === "number" &&
    Number.isFinite(parsed.suggestedYearsExperienceMin) &&
    parsed.suggestedYearsExperienceMin >= 0
      ? Math.round(parsed.suggestedYearsExperienceMin)
      : null;

  return { description, suggestedEmploymentType, suggestedYearsExperienceMin };
}
