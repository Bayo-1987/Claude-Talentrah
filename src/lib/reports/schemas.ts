import { z } from "zod";

/**
 * The four reasons, and what each one is FOR.
 *
 * Kept short and non-overlapping on purpose: a reporting form with twelve
 * options collects twelve unusable buckets, and the operator queue groups by
 * this value. The labels are written for the person clicking, not for the
 * column.
 */
export const REPORT_REASONS = [
  { value: "scam", label: "It looks like a scam" },
  { value: "closed_but_listed", label: "The job is no longer open" },
  { value: "discriminatory", label: "The posting is discriminatory" },
  { value: "other", label: "Something else" },
] as const;

export const REPORT_REASON_VALUES = REPORT_REASONS.map((r) => r.value) as unknown as [
  "scam",
  "closed_but_listed",
  "discriminatory",
  "other",
];

export const reportSchema = z.object({
  jobId: z.uuid("That job posting id isn't valid"),
  reason: z.enum(REPORT_REASON_VALUES, { message: "Pick a reason" }),
  /*
   * Optional, and normalised to null rather than "". The column's check
   * constraint refuses whitespace-only details because "   " reads as though
   * the reporter said something; trimming to null here means the form's empty
   * textarea never trips it.
   */
  details: z
    .string()
    .trim()
    .max(2000, "Keep it under 2,000 characters")
    .transform((v) => (v.length > 0 ? v : null))
    .nullable()
    .default(null),
});
