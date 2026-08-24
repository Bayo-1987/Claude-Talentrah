import { NextResponse } from "next/server";
import { runPassRenewalJob } from "@/lib/billing/renewals";

/**
 * Trigger for the Pass auto-renewal job. Not on any user-facing request
 * path. Two ways in:
 *
 *  GET  — Vercel Cron. Verified against Vercel's docs rather than assumed:
 *         Vercel triggers a cron by making an HTTP *GET* request to the
 *         production deployment, and when a CRON_SECRET env var is set it
 *         sends that value automatically as `Authorization: Bearer <secret>`.
 *         The header name and env var name are both fixed by Vercel — they
 *         are not configurable — which is why this doesn't reuse the
 *         x-renewal-secret scheme below. Schedule lives in vercel.json.
 *  POST — manual/admin on-demand run, kept from the original
 *         implementation so the job stays runnable without waiting for the
 *         cron window (same x-renewal-secret pattern as
 *         /api/admin/ingest-jobs).
 *
 * Vercel does not retry a failed cron invocation, and cron delivery is
 * best-effort (a run can be missed or duplicated). runPassRenewalJob is
 * safe under both: it selects on `next_renewal_date <= today`, so a missed
 * day is picked up by the next run, and a successful charge pushes
 * next_renewal_date into the future so a same-day duplicate run finds
 * nothing to charge.
 */

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  // Fail closed — unlike the POST path below, an unset secret here means
  // misconfiguration, not "local dev with no secret". This endpoint spends
  // real money; it should never be publicly triggerable in production.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return runAndRespond("cron");
}

export async function POST(request: Request) {
  const secret = process.env.PASS_RENEWAL_SECRET;
  if (secret) {
    const provided = request.headers.get("x-renewal-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return runAndRespond("manual");
}

async function runAndRespond(trigger: "cron" | "manual") {
  const summary = await runPassRenewalJob();

  console.log(
    `[pass-renewal] ${trigger} run: ok=${summary.ok} reminders=${summary.remindersSent} renewed=${summary.renewed} lapsed=${summary.lapsed} errors=${summary.errors.length} queryErrors=${summary.queryErrors.length}`,
  );

  // A stage whose work-list query failed skipped an unknown number of
  // Passes, so the zero counters aren't a clean run — answer 500 so a
  // scheduler's failure alerting actually fires instead of seeing 200.
  return NextResponse.json({ summary }, { status: summary.ok ? 200 : 500 });
}
