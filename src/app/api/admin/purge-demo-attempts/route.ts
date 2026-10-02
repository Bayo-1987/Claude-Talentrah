import { NextResponse } from "next/server";
import { purgeOldDemoAttempts } from "@/lib/demo/attempt-retention";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Daily retention purge for the homepage-demo attempt log (0208): deletes attempt rows older than 90 days.
 * Same two-ways-in shape as every other admin/cron route:
 *
 *  GET  — Vercel Cron, `Authorization: Bearer <CRON_SECRET>` (vercel.json).
 *  POST — manual/admin on-demand run, `x-admin-secret`.
 *
 * ITS OWN ROUTE AND ITS OWN CRON ENTRY, not a second step inside /api/admin/delete-stale-postings, even though that route
 * also permanently deletes rows. A failure in one purge must never stop another sweep, and each should have its own
 * log line and cron-dashboard entry: "postings stopped being deleted" and "the demo log stopped being pruned" are
 * different problems and should be tellable apart at a glance. (delete-stale-postings' own header makes the same argument
 * for being separate from the ingest sweeps.)
 *
 * Cron delivery is best-effort and never retried, which is fine: the purge is bounded per run (see attempt-retention.ts)
 * and re-derives what is expired every time, so a missed day is simply caught by the next one.
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
  let result;
  try {
    result = await purgeOldDemoAttempts();
  } catch (err) {
    return internalError("demo-attempt-purge", err);
  }

  // Logged on every run, success or not, and including a run that hit its cap (the next run's work is then visible).
  console.log(
    `[demo-attempt-purge] ${trigger} run: cutoff=${result.cutoff} deleted=${result.deleted} rounds=${result.rounds} hitCap=${result.hitCap}` +
      (result.error ? ` (FAILED: ${result.error})` : ""),
  );

  return NextResponse.json({ result }, { status: result.error ? 500 : 200 });
}
