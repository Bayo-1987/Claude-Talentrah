import { NextResponse } from "next/server";
import { runMatchScoreRefreshJob } from "@/lib/matching/refresh-job";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Trigger for the match-score refresh job (send-latency-2,
 * docs/jobs-feed-pagination.md's own "Step 2" — see refresh-job.ts's own
 * header for the full design). Not on any user-facing request path. Two
 * ways in, same shape as every other admin/cron route in this file's own
 * directory:
 *
 *  GET  — Vercel Cron. Schedule lives in vercel.json.
 *  POST — manual/admin on-demand run.
 *
 * Idempotent and safe under Vercel's best-effort, non-retried cron delivery
 * the same way runPassRenewalJob already is: a missed run just means
 * `match_scores` coverage catches up one run later than it would have, and
 * a duplicate run the same day costs a few no-op queries (every gap it
 * would have filled is already filled) rather than double-writing anything
 * — `persistMatchScores` is an upsert keyed on (user_id, job_posting_id).
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
  let summary;
  try {
    summary = await runMatchScoreRefreshJob();
  } catch (err) {
    return internalError("match-score-refresh", err);
  }

  console.log(
    `[match-score-refresh] ${trigger} run: ok=${summary.ok} eligiblePostings=${summary.eligiblePostings} ` +
      `usersConsidered=${summary.usersConsidered} usersUpToDate=${summary.usersUpToDate} ` +
      `usersRefreshed=${summary.usersRefreshed} postingsScored=${summary.postingsScored} failed=${summary.failed}`,
  );

  // A run whose eligible-board or candidate-user query itself failed
  // skipped an unknown number of users, so ok:false answers 500 — same
  // convention as pass-renewal's own route, so a scheduler's failure
  // alerting actually fires instead of seeing 200.
  return NextResponse.json({ summary }, { status: summary.ok ? 200 : 500 });
}
