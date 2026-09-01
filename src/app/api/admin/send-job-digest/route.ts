import { NextResponse } from "next/server";
import { sendJobMatchDigest } from "@/lib/digest/send";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Weekly job-match digest trigger.
 *
 * GET  — Vercel Cron (`Authorization: Bearer <CRON_SECRET>`), scheduled in
 *        vercel.json. Weekly, on the evidence: over 30 days production took
 *        107 new postings, a mean of 3.6 a day, with seven days taking none at
 *        all. A daily run would have nothing to say roughly one day in four
 *        before per-user match filtering even ran.
 * POST — manual/admin run, matching the other job-runner routes.
 *
 * THE ROUTE DOES NOT CHECK THE FEATURE FLAG. sendJobMatchDigest does, as its
 * first action, before it reads a single recipient. Checking here as well
 * would put the decision in two places, and the one that matters is the one
 * next to the send — a future caller that forgets this route entirely still
 * cannot send while the flag is off.
 *
 * Cron delivery is best-effort and never retried. A missed week is a missed
 * week: `digest_last_sent_at` is only stamped on a successful send, so the
 * next run picks up anyone who was skipped rather than treating them as done.
 */

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  return runAndRespond("cron");
}

export async function POST(request: Request) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;
  return runAndRespond("manual");
}

async function runAndRespond(trigger: "cron" | "manual") {
  try {
    const summary = await sendJobMatchDigest();
    console.log(`[digest] ${trigger} run:`, JSON.stringify(summary));

    /*
     * A disabled feature answers 200. It is not a failure — it is the
     * documented state of this feature today, and a 500 every week would train
     * whoever watches the cron dashboard to ignore it, which is the same
     * instrument-blindness the ingest route's own comment warns about.
     *
     * A run that was enabled and could not send anything IS a failure, because
     * that is the difference between "we chose not to" and "we tried and
     * couldn't" — and only the second needs somebody to look.
     */
    if (summary.enabled && summary.reason) {
      return NextResponse.json({ summary, error: summary.reason }, { status: 500 });
    }
    return NextResponse.json({ summary });
  } catch (err) {
    return internalError("digest", err);
  }
}
