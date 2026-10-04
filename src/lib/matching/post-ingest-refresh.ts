import { REFRESH_MIN_USEFUL_MS, REFRESH_SELF_STOP_MS } from "./post-ingest-refresh-limits";

/**
 * The match-score refresh at the END of the ingest route (owner's decision, 2026-10-03, "option b").
 *
 * WHY. Ingest changes postings several times a day: the GitHub Actions workflow is scheduled every 3 hours but GitHub delays and drops scheduled runs (in practice 4 to 5 runs a day at irregular gaps of 4 to 8 hours), and the Vercel daily cron (05:00 to 05:59 UTC) is the only guaranteed run. A new posting has no
 * stored score, and a posting whose `structured_jd` or `seniority` changed LOSES every user's score (trigger 0069), while the refresh ran once
 * a day, so for hours every reader of stored `match_scores` (the weekly digest, the Auto-Apply review page, employer ranking) saw those
 * postings as unscored and skipped them. On 3 Oct that was 205 of 372 postings. The refresh job is already gap-driven (it scores exactly the
 * (user, posting) pairs with no row), so running it right after ingest closes the gap with no new logic, and the once-a-day 16:00 refresh
 * stays as the safety net (resume edits, anything a deadline cut off).
 *
 * STANDING WARNING FOR WHOEVER NEXT CHANGES INGEST: any change to how ingest derives `seniority` or `structured_jd` (an extractor change, a new
 * default, an enrichment) rewrites those columns on existing postings at the next run, and trigger 0069 (`match_scores_invalidate_on_jd_change`)
 * then deletes EVERY user's stored scores for each posting that changed. That happened on 3 Oct, after #636 (a silent title became `unknown`
 * instead of `mid`): 205 of 372 in-window postings lost their scores until a refresh. This refresh is what closes that gap now, but a change
 * like that still makes the next ingest run's refresh large, so plan for it (and say so in the PR that makes the change) rather than discover it.
 *
 * THE GUARDS.
 *   - It runs LAST: after both expiry sweeps (a closed posting is not scored) and after the proactive alerts (which compute their own scores
 *     and must not be starved of time by this).
 *   - A DEADLINE measured from the route's start (`REFRESH_SELF_STOP_MS`): the refresh stops on a user boundary and reports
 *     `complete: false`; the rest is left to the next run.
 *   - It is SKIPPED, with a logged reason and nothing written, when ingest itself has used so much of the budget that fewer than
 *     `REFRESH_MIN_USEFUL_MS` remain.
 *   - It NEVER THROWS: a refresh failure is a result, so it can never cancel or fail ingestion or change what ingestion reports.
 *   - It logs ONE line (ingest duration, refresh duration, postings refreshed, rows written, complete) with no personal data: no user ids,
 *     no emails, only counts, so the first production run tells us the real time budget.
 */
export interface RefreshSummaryLike {
  ok: boolean;
  usersRefreshed: number;
  postingsScored: number;
  distinctPostingsScored: number;
  failed: number;
  complete: boolean;
  stoppedBy: "deadline" | null;
}

export interface PostIngestRefreshOutcome {
  ran: boolean;
  skippedReason: string | null;
  complete: boolean;
  /** Rows written: one per (user, posting) pair. */
  rowsWritten: number;
  /** Distinct postings that gained a score. */
  postingsRefreshed: number;
  failed: number;
  error?: string;
  /** Milliseconds from the route's start to the moment the refresh was due to begin: everything before it (ingest, sweeps, alerts). */
  ingestMs: number;
  refreshMs: number;
}

/**
 * An error message that is safe to put in a public Actions log and a JSON response: a database error can name a user id (`Key (user_id)=(...)`)
 * or an email, so ids and emails are replaced, and the text is cut short. The useful part of the message (what failed) survives.
 */
export function redactError(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    .slice(0, 200);
}

export async function runPostIngestRefresh(args: {
  routeStartedAtMs: number;
  /** When everything before the refresh (ingest, both sweeps, the alerts) finished, i.e. when the refresh would start. */
  ingestFinishedAtMs: number;
  now: () => number;
  refresh: (opts: { shouldStop: () => boolean }) => Promise<RefreshSummaryLike>;
  log: (line: string) => void;
}): Promise<PostIngestRefreshOutcome> {
  const { routeStartedAtMs, ingestFinishedAtMs, now, refresh, log } = args;
  const ingestMs = Math.max(0, ingestFinishedAtMs - routeStartedAtMs);
  const base = { complete: false, rowsWritten: 0, postingsRefreshed: 0, failed: 0, ingestMs, refreshMs: 0 };

  const remainingMs = REFRESH_SELF_STOP_MS - ingestMs;
  if (remainingMs < REFRESH_MIN_USEFUL_MS) {
    const skippedReason = `ingest used ${Math.round(ingestMs / 1000)}s of the ${Math.round(REFRESH_SELF_STOP_MS / 1000)}s budget, so the refresh was skipped (the 16:00 refresh covers it)`;
    log(`[post-ingest-refresh] skipped: ${skippedReason} (ingestMs=${ingestMs})`);
    return { ...base, ran: false, skippedReason };
  }

  const startedAt = now();
  try {
    const s = await refresh({ shouldStop: () => now() - routeStartedAtMs >= REFRESH_SELF_STOP_MS });
    const refreshMs = Math.max(0, now() - startedAt);
    const complete = s.ok && s.complete;
    const outcome: PostIngestRefreshOutcome = {
      ...base,
      ran: true,
      skippedReason: null,
      complete,
      rowsWritten: s.postingsScored,
      postingsRefreshed: s.distinctPostingsScored,
      failed: s.failed,
      refreshMs,
      ...(s.ok ? {} : { error: "the refresh could not read the board or the users (see the server log)" }),
    };
    log(
      `[post-ingest-refresh] ingestMs=${ingestMs} refreshMs=${refreshMs} postingsRefreshed=${s.distinctPostingsScored} ` +
        `rowsWritten=${s.postingsScored} users=${s.usersRefreshed} failed=${s.failed} complete=${complete} stoppedBy=${s.stoppedBy ?? "none"}` +
        (s.ok ? "" : " ok=false"),
    );
    return outcome;
  } catch (err) {
    const refreshMs = Math.max(0, now() - startedAt);
    const error = redactError(err instanceof Error ? err.message : String(err));
    log(`[post-ingest-refresh] ingestMs=${ingestMs} refreshMs=${refreshMs} postingsRefreshed=0 rowsWritten=0 complete=false failed (${error})`);
    return { ...base, ran: true, skippedReason: null, refreshMs, error };
  }
}
