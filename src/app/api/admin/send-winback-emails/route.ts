import { NextResponse } from "next/server";
import { sendWinbackEmails } from "@/lib/notifications/win-back/send";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * send-467's win-back email trigger — same shape as send-job-digest/route.ts,
 * one send later.
 *
 * GET  — Vercel Cron (`Authorization: Bearer <CRON_SECRET>`), scheduled daily
 *        in vercel.json at 18:00 UTC — deliberately AFTER refresh-match-scores
 *        (16:00 UTC), the same ordering reasoning CLAUDE.md documents for
 *        ingest-jobs vs. the proactive alert: this run reads `match_scores`
 *        to build "what's new", and it should read the SAME day's freshly
 *        recomputed scores, not yesterday's. (17:00 was taken by
 *        send-referral-reward-notifications by the time this merged — the
 *        exact hour doesn't matter, only that it's after 16:00.) Daily,
 *        not weekly like the digest: this send's own eligibility window
 *        (14-21 days since `last_active_at`) is what limits how often any
 *        ONE person can be mailed, not the cron's own cadence — the cron
 *        just has to run often enough that nobody drifts past day 21
 *        unnoticed, which a weekly cadence risks doing.
 * POST — manual/admin run, matching every other job-runner route.
 *
 * THE ROUTE DOES NOT CHECK THE FEATURE FLAG OR THE ELIGIBILITY WINDOW.
 * `sendWinbackEmails` does both, as its own first actions, before reading a
 * single candidate — same reasoning as send-job-digest/route.ts's own
 * comment: the check that matters lives next to the send, not duplicated at
 * the route.
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
    const summary = await sendWinbackEmails();
    console.log(`[win-back] ${trigger} run:`, JSON.stringify(summary));

    // A disabled feature answers 200 — see send-job-digest/route.ts's own
    // comment for why that distinction (chose not to vs. tried and failed)
    // matters for whoever watches the cron dashboard.
    if (summary.enabled && summary.reason) {
      return NextResponse.json({ summary, error: summary.reason }, { status: 500 });
    }
    return NextResponse.json({ summary });
  } catch (err) {
    return internalError("win-back", err);
  }
}
