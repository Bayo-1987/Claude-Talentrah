import { NextResponse } from "next/server";
import { ingestScholarships } from "@/lib/scholarships/ingest";

/**
 * Trigger for the scholarship aggregation pipeline. Not on any user-facing
 * request path. Two ways in, mirroring /api/admin/renew-passes exactly
 * rather than inventing a second auth scheme:
 *
 *  GET  — Vercel Cron. Vercel triggers crons with an HTTP *GET* and sends
 *         the project's CRON_SECRET automatically as
 *         `Authorization: Bearer <secret>`. Both the header and the env var
 *         name are fixed by Vercel and not configurable, which is why this
 *         path can't reuse the INGEST_SECRET scheme below. Schedule lives
 *         in vercel.json.
 *  POST — manual/admin on-demand run, kept from the original
 *         implementation, still gated by INGEST_SECRET via x-ingest-secret
 *         (the same scheme /api/admin/ingest-jobs uses).
 *
 * Cron delivery is best-effort and never retried, so a run can be missed or
 * duplicated. ingestScholarships is safe under both: it upserts on a stable
 * provider+program+cycle fingerprint, so a duplicate run is a no-op rather
 * than a second copy, and a missed day just means the next run re-checks.
 */

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  // Fail closed — unlike POST below, an unset secret here means
  // misconfiguration rather than "local dev with no secret", and this route
  // writes to the public catalog.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return runAndRespond("cron");
}

export async function POST(request: Request) {
  const secret = process.env.INGEST_SECRET;
  if (secret) {
    const provided = request.headers.get("x-ingest-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return runAndRespond("manual");
}

async function runAndRespond(trigger: "cron" | "manual") {
  const summary = await ingestScholarships();

  console.log(
    `[scholarship-ingest] ${trigger} run: ok=${summary.ok} fetched=${summary.fetched} upserted=${summary.upserted} staleMarked=${summary.staleMarked} errors=${summary.errors.length}`,
  );

  // Non-2xx on a failed run so a scheduler's alerting fires instead of
  // reading an all-zero summary as a clean pass — same lesson as the Pass
  // renewal job's query-error handling.
  return NextResponse.json({ summary }, { status: summary.ok ? 200 : 500 });
}
