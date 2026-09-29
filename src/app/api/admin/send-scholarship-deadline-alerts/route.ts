import { NextResponse } from "next/server";
import { sendScholarshipDeadlineAlerts } from "@/lib/scholarship-deadline-alerts/send";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Daily scholarship-deadline-alert trigger.
 *
 * GET  — Vercel Cron (`Authorization: Bearer <CRON_SECRET>`), scheduled in
 *        vercel.json. Daily, not weekly like the job digest: a 5-day window
 *        needs daily granularity to catch a deadline the moment it enters the
 *        window, and unlike the job board's own posting rate this isn't about
 *        having enough NEW content to justify an email — it's about not
 *        missing the one day a save crosses into range.
 * POST — manual/admin run, matching every other job-runner route.
 *
 * THE ROUTE DOES NOT CHECK THE FEATURE FLAG — sendScholarshipDeadlineAlerts
 * does, as its first action, before reading a single candidate. Same
 * reasoning send-job-digest's own route gives: the decision belongs next to
 * the send, not duplicated here where a future caller could forget it.
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
    const summary = await sendScholarshipDeadlineAlerts();
    console.log(`[scholarship-deadline-alerts] ${trigger} run:`, JSON.stringify(summary));

    // A disabled feature answers 200 — the documented state, not a failure.
    // An enabled run that could not send anything IS a failure worth a 500,
    // same distinction send-job-digest's own route draws.
    if (summary.enabled && summary.reason) {
      return NextResponse.json({ summary, error: summary.reason }, { status: 500 });
    }
    return NextResponse.json({ summary });
  } catch (err) {
    return internalError("scholarship-deadline-alerts", err);
  }
}
