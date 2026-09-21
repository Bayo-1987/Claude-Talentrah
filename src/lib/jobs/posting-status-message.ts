import type { Enums } from "@/lib/supabase/types";

/**
 * The job detail page's one-line status callout, extracted to a pure
 * function (send-447) so it's directly testable without rendering the page —
 * the same reason `getJobShareVisibility` (src/lib/employer/job-visibility.ts)
 * is a pure function rather than inline JSX.
 *
 * `null` means "say nothing" — the open case, which needs no callout at all.
 *
 * `draft` gets its own copy rather than reusing "no longer open": that
 * phrase reads as "used to be live, now isn't," which is false for a
 * posting an org member is previewing through their own RLS access before
 * it has ever been published. `closed`/`removed` keep the existing copy
 * unchanged — this send does not touch either.
 */
export function jobPostingStatusMessage(status: Enums<"job_status">): string | null {
  if (status === "open") return null;
  if (status === "draft") return "This posting hasn't been published yet.";
  return "This posting is no longer open.";
}
