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
    const failed = results.filter((r) => r.error);

    /*
     * A run where every source failed used to answer 200.
     *
     * `ingestAllSources` catches per source and records the reason in
     * `results[].error`, which is right — one dead board must not stop the
     * others. But the reason then travelled only in a response body that
     * nothing reads: Vercel records the status code, the cron dashboard shows
     * 2XX, and a totally failed ingest is indistinguishable from a quiet day
     * with no new postings.
     *
     * That is the same shape as the four cleanup bugs found on 2026-08-26 —
     * a call that resolves without throwing, whose result is never checked, so
     * a real failure reads as success. Nothing had actually gone wrong here
     * (the 05:00 run that prompted this check turned out to be healthy), but
     * the instrument was incapable of telling us that, which is the defect.
     *
     * Partial failure stays 200: some sources succeeded and the run did useful
     * work. Only a total failure is a failed run.
     */
    console.log(
      `[job-ingest] ${trigger} run: sources=${results.length} upserted=${total} ` +
        `failed=${failed.length}` +
        (failed.length ? ` — ${failed.map((r) => `${r.source}/${r.identifier}: ${r.error}`).join("; ")}` : ""),
    );

    if (failed.length > 0 && failed.length === results.length) {
      return NextResponse.json(
        { results, error: "every configured source failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({ results });
  } catch (err) {
    // Previously unguarded: a throw from any single source produced an
    // unhandled rejection and a bare 500 with a framework stack, rather than
    // a logged error a scheduler can alert on.
    return internalError("job-ingest", err);
  }
}
