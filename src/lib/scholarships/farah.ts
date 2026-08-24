import "server-only";
import { getLLMProvider } from "@/lib/llm";
import { FARAH_SYSTEM_PROMPT } from "@/lib/farah/system-prompt";
import type { StructuredResume } from "@/lib/resume/types";
import type { Tables } from "@/lib/supabase/types";
import { DEGREE_LEVEL_LABEL, FUNDING_TYPE_LABEL } from "./types";

type ScholarshipRow = Tables<"scholarships">;

/**
 * The two credit-gated Farah actions from §6.15. Both call through the
 * existing LLMProvider abstraction (src/lib/llm) exactly like tailoring and
 * bullet-rewriting already do — no second LLM code path, no provider-
 * specific code here, and nothing in src/lib/llm needed changing.
 */

export interface EligibilityCriterionResult {
  criterion: string;
  status: "meets" | "gap" | "unclear";
  note: string;
}

export interface EligibilityCheckResult {
  verdict: "likely_eligible" | "partly_eligible" | "likely_ineligible";
  summary: string;
  criteria: EligibilityCriterionResult[];
  suggestedNextSteps: string[];
}

const ELIGIBILITY_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["likely_eligible", "partly_eligible", "likely_ineligible"] },
    summary: { type: "string", description: "Two or three sentences, addressed to the applicant." },
    criteria: {
      type: "array",
      items: {
        type: "object",
        properties: {
          criterion: { type: "string", description: "The stated requirement, quoted or paraphrased." },
          status: { type: "string", enum: ["meets", "gap", "unclear"] },
          note: {
            type: "string",
            description:
              "Why, grounded only in the resume provided. Use 'unclear' when the resume simply doesn't say — never guess.",
          },
        },
        required: ["criterion", "status", "note"],
      },
    },
    suggestedNextSteps: { type: "array", items: { type: "string" } },
  },
  required: ["verdict", "summary", "criteria", "suggestedNextSteps"],
} as const;

/** Renders the stated criteria as text so the model compares against the real listing, not a summary of it. */
function describeScholarship(s: ScholarshipRow): string {
  const levels = s.degree_levels.map((l) => DEGREE_LEVEL_LABEL[l]).join(", ");
  return [
    `Programme: ${s.program_name}`,
    `Provider: ${s.provider}`,
    s.host_institution ? `Host institution: ${s.host_institution}` : null,
    `Degree levels: ${levels || "not stated"}`,
    `Funding: ${FUNDING_TYPE_LABEL[s.funding_type]} — covers ${s.funding_covers.join(", ") || "not stated"}`,
    `Fields: ${s.field_tags.join(", ") || "not stated"}`,
    `Stated nationality eligibility: ${s.eligibility_nationalities.join(", ") || "not stated"}`,
    s.eligibility_prior_degree ? `Prior degree required: ${s.eligibility_prior_degree}` : null,
    s.eligibility_age ? `Age requirement: ${s.eligibility_age}` : null,
    s.eligibility_other ? `Other stated requirements: ${s.eligibility_other}` : null,
    s.application_deadline ? `Application deadline: ${s.application_deadline}` : "Deadline: not published",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * §6.15's eligibility check — reuses the gap-analysis framing already built
 * for JD tailoring (§6.3): compare a real profile against real stated
 * criteria, mark each one met/gap/unclear, never invent the user's history.
 */
export async function checkEligibility(
  scholarship: ScholarshipRow,
  resume: StructuredResume,
  profileCountry: string | null,
): Promise<EligibilityCheckResult> {
  const raw = await getLLMProvider().generateText({
    systemPrompt: FARAH_SYSTEM_PROMPT,
    turns: [
      {
        role: "user",
        content: `Check whether I'm eligible for this scholarship, based only on my resume and its stated criteria.

SCHOLARSHIP:
${describeScholarship(scholarship)}

MY COUNTRY (from my profile): ${profileCountry ?? "not stated"}

MY RESUME (JSON):
${JSON.stringify(resume).slice(0, 8000)}

Work criterion by criterion against what the listing actually states. Where my resume doesn't say something the criterion needs, mark it "unclear" rather than assuming either way — do not invent qualifications, dates, or nationality I haven't given you. Talentrah is a discovery layer, not the awarding body, so be explicit that the official page is the authority on current terms.`,
      },
    ],
    maxOutputTokens: 2048,
    jsonSchema: ELIGIBILITY_SCHEMA as unknown as Record<string, unknown>,
  });

  const parsed = JSON.parse(raw) as EligibilityCheckResult;
  return {
    verdict: parsed.verdict ?? "partly_eligible",
    summary: parsed.summary ?? "",
    criteria: Array.isArray(parsed.criteria) ? parsed.criteria : [],
    suggestedNextSteps: Array.isArray(parsed.suggestedNextSteps) ? parsed.suggestedNextSteps : [],
  };
}

/**
 * §6.15's SOP / personal-statement drafting — the scholarship equivalent of
 * cover-letter generation (§6.3/§6.4), priced a tier above it because a
 * personal statement runs roughly 500–1,000 words rather than 300–400.
 */
export async function draftPersonalStatement(
  scholarship: ScholarshipRow,
  resume: StructuredResume,
  motivation: string,
): Promise<string> {
  const text = await getLLMProvider().generateText({
    systemPrompt: FARAH_SYSTEM_PROMPT,
    turns: [
      {
        role: "user",
        content: `Draft a personal statement / statement of purpose for this scholarship.

SCHOLARSHIP:
${describeScholarship(scholarship)}

MY RESUME (JSON):
${JSON.stringify(resume).slice(0, 8000)}

WHY I'M APPLYING (in my own words):
${motivation.slice(0, 2000) || "(not provided — work from my resume alone)"}

Write 500–1000 words in my voice, first person, plain prose with no headings or bullet points. Ground every claim in my actual resume and what I told you above — if you don't have a concrete example for something, leave it out rather than inventing one. Return the statement text only, with no preamble, title, or closing commentary.`,
      },
    ],
    maxOutputTokens: 3072,
  });

  return text.trim();
}
