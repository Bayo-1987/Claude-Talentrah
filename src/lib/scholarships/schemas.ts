import { z } from "zod";
import type { NormalizedScholarship } from "./types";

export const DEGREE_LEVEL_VALUES = [
  "bsc",
  "msc",
  "phd",
  "postgraduate_diploma",
  "other",
] as const;

export const FUNDING_TYPE_VALUES = ["full", "partial"] as const;

/**
 * A comma-separated text input turned into a clean array.
 *
 * Trimmed and emptied-out because a trailing comma is the single most likely
 * thing an operator types, and `["ok", ""]` in `field_tags` becomes an empty
 * filter chip on the public card rather than an error anyone would notice.
 */
const csv = z
  .string()
  .trim()
  .transform((v) =>
    v
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );

/**
 * `official_url` is §6.15's one non-negotiable field — every listing must
 * point at its primary source — so it is the one field validated for shape
 * rather than just presence.
 *
 * Restricted to http/https deliberately. `z.url()` alone accepts
 * `javascript:alert(1)` and `data:text/html,…`, and this value is rendered as
 * an href on a public catalog card, so the scheme is the whole question. An
 * operator pasting a `mailto:` is a mistake worth refusing too.
 */
const officialUrl = z
  .string()
  .trim()
  .min(1, "Every listing needs a link to its official source")
  .max(2048)
  .refine((v) => {
    try {
      const scheme = new URL(v).protocol;
      return scheme === "http:" || scheme === "https:";
    } catch {
      return false;
    }
  }, "Must be a full http(s) link to the provider's own page");

/** Empty string from an untouched form field means "not set", not "". */
const optionalText = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .default(null);

/**
 * A manually posted listing.
 *
 * Mirrors `NormalizedScholarship` rather than the table, because that is what
 * `upsertScholarships` consumes — the manual route and the seed ingestion hand
 * the writer the same shape, which is the point of the extraction.
 *
 * NOTE WHAT IS ABSENT: `moderation_status`. It is not optional here, it is not
 * accepted at all. A field the schema does not declare cannot be smuggled in
 * by a caller who adds it to the JSON body, so "a manual listing always lands
 * pending" is a property of the parse rather than of anyone remembering to
 * strip it downstream. Same for `id` — a caller cannot aim this at an existing
 * row; the fingerprint decides what it collides with.
 */
export const manualScholarshipSchema = z.object({
  provider: z.string().trim().min(2, "Who awards it?").max(200),
  programName: z.string().trim().min(2, "What's the programme called?").max(300),
  hostInstitution: optionalText,
  degreeLevels: z
    .array(z.enum(DEGREE_LEVEL_VALUES))
    .min(1, "Pick at least one degree level"),
  fieldTags: csv.default([]),
  fundingType: z.enum(FUNDING_TYPE_VALUES, { message: "Fully or partially funded?" }),
  fundingCovers: csv.default([]),
  eligibilityNationalities: csv.default([]),
  eligibilityPriorDegree: optionalText,
  eligibilityAge: optionalText,
  eligibilityOther: optionalText,
  /*
   * A date or nothing. Most providers genuinely have no single deadline —
   * they delegate it per partner institution, embassy or call — so an absent
   * date is the common, correct case and `deadlineNote` is what the applicant
   * reads instead. Requiring a date here would make operators invent one.
   */
  applicationDeadline: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD, or leave it blank")
    .nullable()
    .or(z.literal("").transform(() => null))
    .default(null),
  cycleYear: z.coerce
    .number()
    .int()
    .min(2000)
    .max(2100)
    .nullable()
    .or(z.literal("").transform(() => null))
    .default(null),
  officialUrl,
  sourceName: z.string().trim().min(1).max(200).default("Manual entry"),
  deadlineNote: optionalText,
  reviewNote: optionalText,
});

export type ManualScholarshipInput = z.input<typeof manualScholarshipSchema>;

/**
 * The parsed form's one job: become the shape the writer already takes.
 *
 * `deadlineVerifiedAt` is hardcoded null rather than exposed as a field. It
 * records that a deadline was checked against the official URL, and nobody
 * posting a listing through a form has done that check — letting the poster
 * assert it would turn a verification signal into a self-report.
 */
export function toNormalizedScholarship(
  parsed: z.infer<typeof manualScholarshipSchema>,
): NormalizedScholarship {
  return {
    provider: parsed.provider,
    programName: parsed.programName,
    hostInstitution: parsed.hostInstitution,
    degreeLevels: [...parsed.degreeLevels],
    fieldTags: parsed.fieldTags,
    fundingType: parsed.fundingType,
    fundingCovers: parsed.fundingCovers,
    eligibilityNationalities: parsed.eligibilityNationalities,
    eligibilityPriorDegree: parsed.eligibilityPriorDegree,
    eligibilityAge: parsed.eligibilityAge,
    eligibilityOther: parsed.eligibilityOther,
    applicationDeadline: parsed.applicationDeadline,
    cycleYear: parsed.cycleYear,
    officialUrl: parsed.officialUrl,
    sourceName: parsed.sourceName,
    deadlineVerifiedAt: null,
    deadlineNote: parsed.deadlineNote,
    reviewNote: parsed.reviewNote,
  };
}
