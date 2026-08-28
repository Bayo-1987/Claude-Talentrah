import { NextResponse } from "next/server";
import { ingestScholarships } from "@/lib/scholarships/ingest";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Trigger for the scholarship aggregation pipeline. Not on any user-facing
 * request path. Two ways in:
 *
 *  GET  — Vercel Cron. Vercel triggers crons with an HTTP *GET* and sends the
 *         project's CRON_SECRET automatically as `Authorization: Bearer
 *         <secret>`. Both the header and the env var name are fixed by Vercel
 *         and not configurable, which is why this path can't reuse the admin
 *         secret scheme below. Schedule lives in vercel.json.
 *  POST — manual/admin on-demand run.
 *
 * Cron delivery is best-effort and never retried, so a run can be missed or
 * duplicated. ingestScholarships is safe under both: it upserts on a stable
 * provider+program+cycle fingerprint, so a duplicate run is a no-op rather
 * than a second copy, and a missed day just means the next run re-checks.
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
    summary = await ingestScholarships();
  } catch (err) {
    return internalError("scholarship-ingest", err);
  }

  console.log(
    `[scholarship-ingest] ${trigger} run: ok=${summary.ok} fetched=${summary.fetched} upserted=${summary.upserted} returnedToReview=${summary.returnedToReview} staleMarked=${summary.staleMarked} errors=${summary.errors.length}`,
  );

  // Non-2xx on a failed run so a scheduler's alerting fires instead of
  // reading an all-zero summary as a clean pass — same lesson as the Pass
  // renewal job's query-error handling.
  return NextResponse.json({ summary }, { status: summary.ok ? 200 : 500 });
}
