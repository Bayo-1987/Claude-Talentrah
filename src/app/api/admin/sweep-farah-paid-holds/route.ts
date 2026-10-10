import { NextResponse } from "next/server";
import { sweepPaidHolds } from "@/lib/farah/paid-hold-sweep";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * The daily paid-hold sweep (src/lib/farah/paid-hold-sweep.ts): refunds each Farah paid message that was charged but never completed (a process killed between the spend and the release), once. Its own route and cron
 * entry, so a failure here never stops another sweep and it has its own logs.
 *
 *  GET  — Vercel Cron, with `Authorization: Bearer <CRON_SECRET>` (schedule in vercel.json).
 *  POST — an on-demand run with the admin secret.
 *
 * The answer is the COUNT the daily digest reads: { examined, orphaned, refunded, alreadyRefunded, failed }. A run that could not read its work list, or failed a refund, answers 500 so the scheduler's failure surface
 * fires instead of a quiet 200. Overlapping runs are safe: migration 0252's unique index lets each hold be refunded only once. The library writes the single content-free log line.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  return runAndRespond();
}

export async function POST(request: Request) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;
  return runAndRespond();
}

async function runAndRespond() {
  let summary;
  try {
    summary = await sweepPaidHolds();
  } catch (err) {
    return internalError("farah-paid-hold-sweep", err);
  }
  // Counts only: the database's own error text (readError) stays in the server log.
  const counts = { ok: summary.ok, examined: summary.examined, orphaned: summary.orphaned, refunded: summary.refunded, alreadyRefunded: summary.alreadyRefunded, failed: summary.failed };
  return NextResponse.json({ summary: counts }, { status: summary.ok ? 200 : 500 });
}
