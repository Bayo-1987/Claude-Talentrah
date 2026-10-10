import { z } from "zod";

import { REPORT_REASON_VALUES } from "./reasons";

// The reasons live in ./reasons (no zod), so the client-side report menu does not pull this file, and zod, into the browser.
export { REPORT_REASONS, REPORT_REASON_VALUES } from "./reasons";

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
