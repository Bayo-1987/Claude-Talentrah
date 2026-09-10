/**
 * Fields "Import from URL" can pre-fill on JobPostingForm (send-136).
 *
 * Deliberately the SAME shape as (a subset of) JobFormValues
 * (src/components/employer/job-posting-form.tsx) rather than a bespoke DTO —
 * this exists only to pre-fill that form, so drifting from its field names
 * would just add a translation step with nothing to translate for. There is
 * no `companyName` field here: JobPostingForm has none either — `postJobAction`
 * always writes `organization.name` as the posting's company, so an
 * employer's own org identity is never something a fetched page could
 * override.
 *
 * Every field is nullable, and null means exactly one thing: the extraction
 * did not find this on the page. It never means "the model guessed and this
 * is its best effort" — see extract.ts's own contract for how that is
 * enforced. The employer reviews and fills in whatever came back blank
 * before anything is ever saved (postJobAction runs the same validation on
 * an imported draft as on a hand-typed one, so a blank required field still
 * blocks submission exactly as it would from the empty form).
 */
export interface ExtractedJobFields {
  title: string | null;
  location: string | null;
  description: string | null;
  workType: "remote" | "hybrid" | "onsite" | null;
  employmentType: "full_time" | "part_time" | "contract" | "internship" | null;
  seniority: "entry" | "mid" | "senior" | "lead" | "executive" | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryUnit: "hour" | "day" | "week" | "month" | "year" | null;
}

export const EMPTY_EXTRACTED_JOB_FIELDS: ExtractedJobFields = {
  title: null,
  location: null,
  description: null,
  workType: null,
  employmentType: null,
  seniority: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryUnit: null,
};

/**
 * How the fields were produced — surfaced to the employer (and asserted in
 * tests) because the two paths carry different trust levels. `structured-data`
 * came from the page's own schema.org/JobPosting JSON-LD, parsed
 * deterministically with no model in the loop at all — the same vetted
 * parser src/lib/jobs/sources/schema-org.ts uses for aggregation. `llm` means
 * a model read the page's visible text and extracted fields from it, which is
 * the only path that can, in principle, misread something — the fabrication
 * discipline in extract.ts's prompt and sanitizer is what keeps "misread" from
 * becoming "invented".
 */
export type ExtractionMethod = "structured-data" | "llm";

export type ImportJobResult =
  | { ok: true; fields: ExtractedJobFields; method: ExtractionMethod; warning?: string }
  | { ok: false; message: string };
