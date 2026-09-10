import "server-only";
import { generateWithFailover, LLMProviderError } from "@/lib/llm";
import { inferSeniority, stripHtml } from "@/lib/jobs/extract-jd";
import {
  extractJsonLdNodes,
  formatLocation,
  isRecord,
  mapBaseSalary,
  mapEmploymentType,
  mapWorkType,
  validateJobPosting,
} from "@/lib/jobs/sources/schema-org";
import {
  EXTRACTION_MAX_OUTPUT_TOKENS,
  truncatePageText,
} from "./token-budget";
import { EMPTY_EXTRACTED_JOB_FIELDS, type ExtractedJobFields, type ImportJobResult } from "./types";

const WORK_TYPES = ["remote", "hybrid", "onsite"] as const;
const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "internship"] as const;
const SENIORITIES = ["entry", "mid", "senior", "lead", "executive"] as const;
const SALARY_UNITS = ["hour", "day", "week", "month", "year"] as const;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function currencyOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : null;
}

/**
 * Turns whatever the model returned into ExtractedJobFields — the ONE place
 * that decides what counts as "the extraction found this". Every branch
 * above returns `null` on anything that isn't cleanly the expected type or a
 * member of the expected enum; there is no fallback branch that guesses a
 * default instead. This is what CLAUDE.md's "no invented content" discipline
 * means concretely for this feature: a model that hallucinates a value in
 * the wrong shape (a number as a string, an enum value that isn't one of the
 * four this form accepts) gets that field dropped to null rather than
 * coerced into something that looks plausible. tests/employer/job-import
 * exercises this function directly with deliberately incomplete/malformed
 * model output — see that suite for why a mocked LLM, not a real one, is
 * what proves this contract holds.
 */
export function sanitizeExtractedFields(raw: unknown): ExtractedJobFields {
  if (!isRecord(raw)) return { ...EMPTY_EXTRACTED_JOB_FIELDS };
  const min = numberOrNull(raw.salaryMin);
  const max = numberOrNull(raw.salaryMax);
  return {
    title: stringOrNull(raw.title),
    location: stringOrNull(raw.location),
    description: stringOrNull(raw.description),
    workType: oneOf(raw.workType, WORK_TYPES),
    employmentType: oneOf(raw.employmentType, EMPLOYMENT_TYPES),
    seniority: oneOf(raw.seniority, SENIORITIES),
    // An inverted range isn't a fact the page stated either — same "omit,
    // don't guess" rule src/lib/jobs/sources/schema-org.ts's mapBaseSalary
    // applies to the same ambiguity.
    salaryMin: min !== null && max !== null && max < min ? null : min,
    salaryMax: min !== null && max !== null && max < min ? null : max,
    salaryCurrency: currencyOrNull(raw.salaryCurrency),
    salaryUnit: oneOf(raw.salaryUnit, SALARY_UNITS),
  };
}

const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: ["string", "null"] },
    location: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    workType: { type: ["string", "null"], enum: [...WORK_TYPES, null] },
    employmentType: { type: ["string", "null"], enum: [...EMPLOYMENT_TYPES, null] },
    seniority: { type: ["string", "null"], enum: [...SENIORITIES, null] },
    salaryMin: { type: ["number", "null"] },
    salaryMax: { type: ["number", "null"] },
    salaryCurrency: { type: ["string", "null"], description: "3-letter ISO 4217 code, e.g. NGN or USD" },
    salaryUnit: { type: ["string", "null"], enum: [...SALARY_UNITS, null] },
  },
  required: [
    "title",
    "location",
    "description",
    "workType",
    "employmentType",
    "seniority",
    "salaryMin",
    "salaryMax",
    "salaryCurrency",
    "salaryUnit",
  ],
} as const;

/**
 * kept in sync with token-budget.ts's SYSTEM_PROMPT_CHARS — that constant
 * exists so the budget test measures this real string; if this prompt grows
 * materially, update SYSTEM_PROMPT_CHARS too (its own test asserts the two
 * don't drift apart silently).
 */
const SYSTEM_PROMPT = `You extract job posting fields from the text of a web page an employer pasted a link to. This is the employer's OWN page about a role they are posting, not a resume or a third party's content.

Rules, followed exactly:
- Only extract information that is LITERALLY present in the page text below. Never invent, infer, guess, or embellish a value that isn't stated.
- If a field is not clearly present on the page, return null for it. A null is a correct, expected answer — it is not a failure, and it is always better than a guessed value.
- For "description", reproduce the actual job description/responsibilities/requirements text found on the page, lightly cleaned of navigation, cookie banners, and unrelated site chrome — do not paraphrase, summarise, or add sentences that are not on the page.
- "workType" is one of remote/hybrid/onsite; "employmentType" is one of full_time/part_time/contract/internship; "seniority" is one of entry/mid/senior/lead/executive. Only set one of these if the page's own text supports that exact value — otherwise null.
- Salary fields are only set if the page states an actual number and currency. Never estimate a market-rate salary.

Respond with ONLY the JSON object described by the schema. No commentary.`;

/**
 * Attempts the deterministic path first: if the page carries a valid
 * schema.org JobPosting JSON-LD block (the exact same shape
 * src/lib/jobs/sources/schema-org.ts already parses for aggregation), read
 * it directly — no model call, no possibility of misreading, because there
 * is nothing to read besides the source's own structured data. Falls back to
 * `null` when no such block exists so the caller knows to use the LLM path
 * instead; this never THROWS on malformed JSON-LD, matching the aggregation
 * fetcher's own "skip, don't crash the batch" contract (validateJobPosting).
 */
export function extractFromStructuredData(html: string): ExtractedJobFields | null {
  const nodes = extractJsonLdNodes(html);
  const candidate = nodes.find((n) => isRecord(n) && n["@type"] === "JobPosting");
  if (!candidate) return null;

  const validated = validateJobPosting(candidate);
  if ("error" in validated) return null;

  const salary = mapBaseSalary(validated.baseSalary);
  return {
    title: validated.title,
    location: formatLocation(validated) ?? null,
    description: validated.description ? stripHtml(validated.description) : null,
    workType: mapWorkType(validated) ?? null,
    employmentType: mapEmploymentType(validated.employmentType) ?? null,
    seniority: inferSeniority(validated.title) ?? null,
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryCurrency: salary?.currency ?? null,
    salaryUnit: salary?.unit ?? null,
  };
}

/**
 * Extracts job fields from the model, given already-bounded page text (the
 * caller — action.ts — is responsible for calling truncatePageText first;
 * this re-truncates defensively so a future caller that forgets to cannot
 * silently reproduce the TPM/TPD failure class CLAUDE.md documents for
 * Farah). Routed through `generateWithFailover` (src/lib/llm/index.ts), the
 * same Groq→Gemini rate-limit failover every other real generation call site
 * in this codebase uses — see that module's own header for why this is
 * deliberately not a second, bespoke provider call.
 */
export async function extractWithLLM(pageText: string): Promise<ImportJobResult> {
  const { text: bounded } = truncatePageText(pageText);

  let raw: string;
  try {
    raw = await generateWithFailover((provider) =>
      provider.generateText({
        systemPrompt: SYSTEM_PROMPT,
        turns: [{ role: "user", content: `Page text:\n\n${bounded}` }],
        maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
        jsonSchema: EXTRACTION_JSON_SCHEMA,
      }),
    );
  } catch (err) {
    const message =
      err instanceof LLMProviderError
        ? "Couldn't read that page right now — try again in a moment, or fill in the details below."
        : "Couldn't extract details from that page.";
    return { ok: false, message };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      message: "Couldn't make sense of that page — paste the details in below.",
    };
  }

  return { ok: true, fields: sanitizeExtractedFields(parsed), method: "llm" };
}

/**
 * The single entry point action.ts calls: structured data first, LLM only
 * when the page doesn't carry a usable JobPosting block. Never both — a page
 * that carries good structured data has nothing left for the model to add
 * that isn't a rephrasing of the same facts, at the cost of a real LLM call
 * this feature doesn't need to make.
 */
export async function extractJobFields(html: string, text: string): Promise<ImportJobResult> {
  const structured = extractFromStructuredData(html);
  if (structured) return { ok: true, fields: structured, method: "structured-data" };
  return extractWithLLM(text);
}
