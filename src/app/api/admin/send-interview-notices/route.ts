import { NextResponse } from "next/server";
import { runInterviewNotices } from "@/lib/interviews/notices";
import { defaultNoticeDeps } from "@/lib/interviews/deps";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * The scheduled interview emails (0253), hourly: the backstops (cancel what the trigger missed, expire offers whose times have all passed), the ONE neutral cancellation email to a candidate whose booked interview the employer's
 * "not a fit" cancelled, and the reminder 23 to 25 hours before each booked interview (to the candidate and to the member who made the offer). Each notice is claimed exactly once in the database, so overlapping runs send it once.
 *
 *  GET  — Vercel Cron, with `Authorization: Bearer <CRON_SECRET>` (schedule in vercel.json).
 *  POST — an on-demand run with the admin secret.
 *
 * Counts only in the answer; 500 when a step failed (a release for retry also counts) so the scheduler's failure surface fires.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  return run();
}

export async function POST(request: Request) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;
  return run();
}

async function run() {
  try {
    const summary = await runInterviewNotices(defaultNoticeDeps());
    return NextResponse.json({ summary }, { status: summary.ok ? 200 : 500 });
  } catch (err) {
    return internalError("interview-notices", err);
  }
}
