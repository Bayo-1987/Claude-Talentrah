import { NextResponse } from "next/server";
import { deleteStaleClosedPostings } from "@/lib/jobs/posting-deletion";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Trigger for Stage 5b's job-posting deletion sweep. Not on any user-facing
 * request path. Same two-ways-in shape every other admin/cron route in this
 * file uses (see ingest-jobs/route.ts and renew-passes/route.ts for the two
 * this was modelled on):
 *
 *  GET  — Vercel Cron, `Authorization: Bearer <CRON_SECRET>` (vercel.json).
 *  POST — manual/admin on-demand run.
 *
 * DELIBERATELY ITS OWN ROUTE, not folded into /api/admin/ingest-jobs even
 * though that route already runs two maintenance sweeps on its own schedule.
 * Those two only ever flip `status`; this one permanently removes rows. Giving
 * it a separate route means a failure here shows up as its own log line and
 * its own cron-dashboard entry, rather than as one more number inside
 * ingest-jobs' combined summary line — the difference between "a status sweep
 * had a bad day" and "postings stopped being deleted" is worth being able to
 * tell apart at a glance.
 *
 * Cron delivery is best-effort and never retried, and that is fine here:
 * deleteStaleClosedPostings re-asserts its full WHERE clause inside every
 * delete batch (see that module's own comment), so a missed day is simply
 * caught by the next one, and two runs landing close together delete the
 * overlap once and find nothing the second time.
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
    result = await deleteStaleClosedPostings();
  } catch (err) {
    return internalError("job-deletion", err);
  }

  // Reported on every run, success or not — a deletion job whose logs go
  // quiet on a bad day is indistinguishable from one with nothing to delete,
  // which is exactly the class of bug CLAUDE.md's own history section is full
  // of (a call that resolves without throwing, whose result nobody checked).
  console.log(
    `[job-deletion] ${trigger} run: eligible=${result.eligible} deleted=${result.deleted}` +
      (result.error ? ` (FAILED: ${result.error})` : ""),
  );

  return NextResponse.json({ result }, { status: result.error ? 500 : 200 });
}
