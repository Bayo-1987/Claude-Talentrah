"use server";

import { createClient } from "@/lib/supabase/server";
import { reportSchema } from "./schemas";
import type { ReportActionState } from "./state";

/** Postgres unique_violation — the one-report-per-person constraint. */
const UNIQUE_VIOLATION = "23505";

export async function reportJobPostingAction(
  _prevState: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const parsed = reportSchema.safeParse({
    jobId: formData.get("jobId"),
    reason: formData.get("reason"),
    details: formData.get("details") ?? "",
  });

  if (!parsed.success) {
    return { status: "error", error: "Pick a reason before sending." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: "error", error: "Sign in again — your session has expired." };
  }

  /*
   * No `.select()`. 0057 revokes SELECT, and `INSERT ... RETURNING` needs it —
   * chaining one here would fail AFTER the row was written, telling the
   * reporter their report failed when it landed. Same coupling as feedback.
   *
   * And no "have you already reported this?" read first. There is no SELECT to
   * do it with, and it would be the wrong shape anyway: two taps in quick
   * succession would both pass the check and one would still fail on insert.
   * The unique constraint IS the check, and 23505 is its answer — one
   * statement, one outcome.
   */
  const { error } = await supabase.from("job_posting_reports").insert({
    job_posting_id: parsed.data.jobId,
    reporter_id: user.id,
    reason: parsed.data.reason,
    details: parsed.data.details,
  });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // Not an error to apologise for — it means we already have it.
      return { status: "duplicate", error: null };
    }
    console.error("[report-job-posting:insert]", error);
    return { status: "error", error: "We couldn't send that just now. Try again in a moment." };
  }

  return { status: "success", error: null };
}
