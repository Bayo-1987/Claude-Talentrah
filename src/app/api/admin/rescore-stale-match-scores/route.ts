import { NextResponse } from "next/server";
import { runRescoreStaleJob } from "@/lib/matching/rescore-stale-job";
import { requireAdminSecret, internalError } from "@/lib/api/admin-auth";
import { RESCORE_SELF_STOP_MS } from "@/lib/matching/rescore-stale-limits";

/** Literal on purpose (Next reads it statically): the Hobby maximum, valid on every plan. tests/matching/rescore-stale-limits.test.ts pins it against RESCORE_SELF_STOP_MS. */
export const maxDuration = 300;

/**
 * One-off trigger for the stale-only match-score rescore (rescore-stale.ts): rows computed before A2's role-family check, which carry no
 * `explanation.roleFit`. POST only, behind the admin secret, and NOT on a schedule: it is run by hand, once, after a dry run.
 *
 *   POST                                         dry run: counts only, writes nothing, covers every stale row
 *   POST  {"write": true}                        rescoring for real, BOUNDED: at most DEFAULT_WRITE_MAX_ROWS rows, whole users only
 *   POST  {"write": true, "cursor": "<user id>"}  carry on after the `nextCursor` the previous response reported
 *   optional `maxRows` (1..MAX_ROWS_LIMIT) overrides the bound, on a dry run too
 *
 * Safe to repeat and safe to interrupt: a rescored row carries roleFit, so it is never listed again; the response says `complete`
 * (nothing left after this run) or hands back `nextCursor`. A run also stops by itself before the platform timeout (RESCORE_SELF_STOP_MS), at
 * a write boundary, so a timeout is not how it normally ends. Run it until `complete` is true.
 */
const DEFAULT_WRITE_MAX_ROWS = 1000;
const MAX_ROWS_LIMIT = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  let body: { write?: unknown; maxRows?: unknown; cursor?: unknown } = {};
  try {
    body = ((await request.json()) as typeof body) ?? {};
  } catch {
    // no body / not JSON: a dry run
  }
  const dryRun = body.write !== true;

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
      `toRescore=${summary.rowsToRescore} rescored=${summary.rowsRescored} noResume=${summary.skippedNoBaseResume.length} failed=${summary.failed} ` +
      `complete=${summary.complete} nextCursor=${summary.nextCursor ?? "none"}`,
  );
  return NextResponse.json({ summary }, { status: summary.ok ? 200 : 500 });
}
