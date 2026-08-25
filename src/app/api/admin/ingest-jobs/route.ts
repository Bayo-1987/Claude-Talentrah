import { NextResponse } from "next/server";
import { ingestAllSources } from "@/lib/jobs/ingest";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Trigger for the job aggregation pipeline. Not on any user-facing request
 * path. Two ways in, matching the shape the other two job-runner routes
 * already use:
 *
 *  GET  — Vercel Cron (`Authorization: Bearer <CRON_SECRET>`), scheduled in
 *         vercel.json. This route's own comment used to say "point a Vercel
 *         Cron job at this once deployed" — nothing ever did, so the job feed
 *         only refreshed when someone ran the trigger by hand. A daily cron is
 *         clearly right here and costs nothing: ingestion is heuristic-only
 *         (no LLM call anywhere under src/lib/jobs/), so unlike
 *         /api/admin/estimate-llm-costs a scheduled run spends no model
 *         budget.
 *  POST — manual/admin on-demand run.
 *
 * Cron delivery is best-effort and never retried. ingestAllSources is safe
 * under both a missed and a duplicated run: it upserts on a stable source +
 * external-id fingerprint, so a repeat run refreshes rows rather than
 * duplicating them, and a missed day is picked up by the next one.
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
    const results = await ingestAllSources();
    const total = results.reduce((n, r) => n + r.upserted, 0);
    console.log(
      `[job-ingest] ${trigger} run: sources=${results.length} upserted=${total}`,
    );
    return NextResponse.json({ results });
  } catch (err) {
    // Previously unguarded: a throw from any single source produced an
    // unhandled rejection and a bare 500 with a framework stack, rather than
    // a logged error a scheduler can alert on.
    return internalError("job-ingest", err);
  }
}
