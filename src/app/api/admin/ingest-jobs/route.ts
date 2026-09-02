import { NextResponse } from "next/server";
import { ingestAllSources } from "@/lib/jobs/ingest";
import {
  closeExpiredInternalPostings,
  closeStaleExternalPostings,
  EXTERNAL_STALE_AFTER_HOURS,
} from "@/lib/jobs/expiry";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Trigger for the job aggregation pipeline. Not on any user-facing request
 * path. Two ways in, matching the shape the other two job-runner routes
 * already use:
 *
 *  GET  — cron, `Authorization: Bearer <CRON_SECRET>`. TWO schedules call
 *         this GET, on purpose, not one migrated to the other:
 *           - Vercel Cron, daily (vercel.json) — the original schedule, kept
 *             as a backstop that does not depend on GitHub Actions staying
 *             healthy.
 *           - GitHub Actions, every 3 hours
 *             (.github/workflows/ingest-jobs-3hourly.yml) — the founder chose
 *             this over a paid Vercel plan upgrade for higher-frequency cron.
 *             Same secret, same route, same auth check; the workflow file
 *             documents why the secret can never reach a log line.
 *         Both share `CRON_SECRET`, so this route cannot tell which one
 *         called it, which is deliberate — a run is a run, and ingestion
 *         plus both sweeps below are idempotent regardless of who triggered
 *         them or how close together two calls land.
 *  POST — manual/admin on-demand run.
 *
 * Cron delivery is best-effort and never retried. ingestAllSources is safe
 * under both a missed and a duplicated run: it upserts on a stable source +
 * external-id fingerprint, so a repeat run refreshes rows rather than
 * duplicating them, and a missed cycle is picked up by the next one — now as
 * little as 3 hours later rather than a full day.
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
    /*
     * Runs BEFORE ingestion, and its failure is not allowed to cancel the run.
     *
     * Before, because an expired internal posting should not survive a run
     * just because a board timed out afterwards. Non-fatal, because these are
     * two unrelated jobs sharing a schedule: ingestion refreshes external
     * postings, this closes internal ones whose employer-set date passed, and
     * neither is a reason to skip the other. It rides this cron rather than
     * getting its own so there is one daily job-maintenance run, not two
     * schedules and two secrets to keep working.
     */
    let expiry: { closed: number; error?: string };
    try {
      const swept = await closeExpiredInternalPostings();
      expiry = { closed: swept.closed };
      if (swept.closed > 0) {
        console.log(
          `[job-expiry] closed ${swept.closed} internal posting(s) past their ` +
            `employer-set expiry: ${swept.ids.join(", ")}`,
        );
      }
    } catch (err) {
      // Logged, not swallowed silently — a sweep that stops working must not
      // look identical to a day with nothing to close.
      expiry = { closed: 0, error: err instanceof Error ? err.message : String(err) };
      console.error(`[job-expiry] sweep FAILED, continuing to ingestion:`, err);
    }

    const results = await ingestAllSources();
    const total = results.reduce((n, r) => n + r.upserted, 0);
    const failed = results.filter((r) => r.error);

    /*
     * Runs AFTER ingestion, deliberately the opposite order from the internal
     * sweep above. `ingestAllSources` just bumped `last_checked_at` for every
     * posting its sources actually re-confirmed this run, so checking
     * staleness afterward means a row this very run reconfirmed can never be
     * closed and immediately reopened by the next line — running it first
     * would still be CORRECT (the upsert unconditionally sets `status:
     * "open"` for anything it sees), just a pointless close-then-reopen on
     * every row this run refreshes.
     */
    let staleSweep: { closed: number; error?: string };
    try {
      const swept = await closeStaleExternalPostings();
      staleSweep = { closed: swept.closed };
      if (swept.closed > 0) {
        console.log(
          `[job-expiry] closed ${swept.closed} external posting(s) not re-confirmed by any ` +
            `source in over ${EXTERNAL_STALE_AFTER_HOURS}h: ${swept.ids.join(", ")}`,
        );
      }
    } catch (err) {
      staleSweep = { closed: 0, error: err instanceof Error ? err.message : String(err) };
      console.error(`[job-expiry] stale-external sweep FAILED:`, err);
    }

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
        `expired=${expiry.closed}${expiry.error ? ` (sweep failed: ${expiry.error})` : ""} ` +
        `staleClosed=${staleSweep.closed}${staleSweep.error ? ` (sweep failed: ${staleSweep.error})` : ""} ` +
        `failed=${failed.length}` +
        (failed.length ? ` — ${failed.map((r) => `${r.source}/${r.identifier}: ${r.error}`).join("; ")}` : ""),
    );

    if (failed.length > 0 && failed.length === results.length) {
      return NextResponse.json(
        { results, expiry, staleSweep, error: "every configured source failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({ results, expiry, staleSweep });
  } catch (err) {
    // Previously unguarded: a throw from any single source produced an
    // unhandled rejection and a bare 500 with a framework stack, rather than
    // a logged error a scheduler can alert on.
    return internalError("job-ingest", err);
  }
}
