import { NextResponse } from "next/server";
import { runRescoreStaleJob, runVerifyRescoredSample } from "@/lib/matching/rescore-stale-job";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";
import { RESCORE_SELF_STOP_MS } from "@/lib/matching/rescore-stale-limits";

/** Literal on purpose (Next reads it statically): the Hobby maximum, valid on every plan. tests/matching/rescore-stale-limits.test.ts pins it against RESCORE_SELF_STOP_MS. */
export const maxDuration = 300;

/**
 * One-off trigger for the stale-only match-score rescore (rescore-stale.ts): rows computed before A2's role-family check, which carry no
 * `explanation.roleFit`. POST only, NOT on a schedule: it is run by hand (the manual workflow .github/workflows/rescore-stale-match-scores.yml,
 * or a direct call), once, after a dry run.
 *
 * AUTH: the shared constant-time admin secret OR the deployment's CRON_SECRET as a Bearer token. The second is what lets the manual workflow call
 * this with the repo secret the ingest workflow already uses (no new secret exists). Both comparisons are timing-safe, and a request that fails
 * both gets the same bare 401 with no detail.
 *
 *   POST                                         DRY RUN: computes the new scores read-only and reports the SHAPE of the change; writes nothing
 *   POST  {"write": true}                        rescoring for real, BOUNDED: at most DEFAULT_WRITE_MAX_ROWS rows, whole users only (a user above the
 *                                                limit is processed whole, never starved)
 *   POST  {"write": true, "cursor": "<user id>"}  carry on after the `nextCursor` the previous response reported
 *   POST  {"verify": 20}                         after a write run: recompute a random sample of already-rescored rows and compare them with what
 *                                                is stored (counts only)
 *   optional `maxRows` (1..MAX_ROWS_LIMIT) overrides the bound, on a dry run too
 *
 * NO PERSONAL DATA IN THE RESPONSE OR THE LOG: the response carries counts, buckets and numbers; users with no base resume are `{ rows }` only
 * and errors are messages with any id redacted. The one internal id is `nextCursor`, which the caller must hand back to resume: the workflow
 * keeps it in a shell variable and never prints it, and the log line below says only whether one is set.
 *
 * Safe to repeat and safe to interrupt: a rescored row carries roleFit, so it is never listed again; the response says `complete`
 * (nothing left after this run) or hands back `nextCursor`. A run also stops by itself before the platform timeout (RESCORE_SELF_STOP_MS), at
 * a write boundary, so a timeout is not how it normally ends. Run it until `complete` is true.
 */
const DEFAULT_WRITE_MAX_ROWS = 1000;
const MAX_ROWS_LIMIT = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERIFY_MAX = 100;
const redactIds = (text: string) => text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>").slice(0, 200);

export async function POST(request: Request) {
  // The admin secret OR the cron secret (Bearer). Each check is constant-time; failing both answers with the same bare 401.
  const denied = requireAdminSecret(request);
  if (denied && requireCronSecret(request)) return denied;

  let body: { write?: unknown; maxRows?: unknown; cursor?: unknown; verify?: unknown } = {};
  try {
    body = ((await request.json()) as typeof body) ?? {};
  } catch {
    // no body / not JSON: a dry run
  }
  const dryRun = body.write !== true;

  if (body.verify !== undefined) {
    if (typeof body.verify !== "number" || !Number.isInteger(body.verify) || body.verify < 1 || body.verify > VERIFY_MAX || body.write === true) {
      return NextResponse.json({ error: `verify must be a whole number from 1 to ${VERIFY_MAX} and cannot be combined with write` }, { status: 400 });
    }
    try {
      const verify = await runVerifyRescoredSample(body.verify);
      console.log(`[rescore-stale] verify checked=${verify.checked} matching=${verify.matching} mismatching=${verify.mismatching} unverifiable=${verify.unverifiable}`);
      return NextResponse.json({ verify }, { status: 200 });
    } catch (err) {
      return internalError("rescore-stale-match-scores-verify", err);
    }
  }

  let maxRows: number | undefined;
  if (body.maxRows !== undefined) {
    if (typeof body.maxRows !== "number" || !Number.isInteger(body.maxRows) || body.maxRows < 1 || body.maxRows > MAX_ROWS_LIMIT) {
      return NextResponse.json({ error: `maxRows must be a whole number from 1 to ${MAX_ROWS_LIMIT}` }, { status: 400 });
    }
    maxRows = body.maxRows;
  } else if (!dryRun) {
    maxRows = DEFAULT_WRITE_MAX_ROWS;
  }
  let cursor: string | null = null;
  if (body.cursor !== undefined && body.cursor !== null) {
    if (typeof body.cursor !== "string" || !UUID.test(body.cursor)) {
      return NextResponse.json({ error: "cursor must be the user id a previous run returned as nextCursor" }, { status: 400 });
    }
    cursor = body.cursor;
  }

  const startedAt = Date.now();
  let summary;
  try {
    summary = await runRescoreStaleJob({ dryRun, maxRows, cursor, shouldStop: () => Date.now() - startedAt > RESCORE_SELF_STOP_MS });
  } catch (err) {
    return internalError("rescore-stale-match-scores", err);
  }
  console.log(
    `[rescore-stale] dryRun=${summary.dryRun} stale=${summary.staleRows} users=${summary.usersWithStaleRows} ` +
      `toRescore=${summary.rowsToRescore} rescored=${summary.rowsRescored} noResume=${summary.skippedNoBaseResume.length} stubSkipped=${summary.skippedStubSkill} ` +
      `failed=${summary.failed} complete=${summary.complete} cursor=${summary.nextCursor ? "set" : "none"}`,
  );
  // No personal data: counts only for the users skipped, and error messages with any id redacted.
  const publicSummary = {
    ...summary,
    skippedNoBaseResume: summary.skippedNoBaseResume.map(({ rows }) => ({ rows })).sort((a, b) => b.rows - a.rows),
    errors: summary.errors.map(({ message }) => ({ message: redactIds(message) })),
  };
  return NextResponse.json({ summary: publicSummary }, { status: summary.ok ? 200 : 500 });
}
