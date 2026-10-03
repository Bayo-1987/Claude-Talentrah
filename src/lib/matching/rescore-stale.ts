import { computeMatchScore } from "./score";
import { getMatchTier } from "@/lib/match-tier";
import type { ScoredJobLike } from "./compute-and-store";
import type { StructuredResume } from "@/lib/resume/types";
import type { SeniorityLevel } from "@/lib/jobs/types";

/**
 * The stale-only rescore (follows A2, tests/matching/rescore-stale.test.ts).
 *
 * A2 caps a match score when it is COMPUTED (role-fit.ts), so every row `match_scores` already holds was computed under the old rules and
 * carries no `explanation.roleFit`. The feed and the job page recompute what they render, but the readers that do not (the Auto-Apply
 * scan, the digest, employer ranking) would read old and new values side by side. This rescoring touches exactly the rows without
 * `roleFit`, for users who have a base resume, and nothing else.
 *
 * Pure orchestration over four injected ports (rescore-stale-job.ts supplies the real ones), so the behaviour is tested without a database:
 *   - only stale rows are listed, loaded and written;
 *   - a user with no base resume is skipped and LISTED (nothing to score against; /jobs scores such a user against an empty resume);
 *   - a stale row whose posting is closed or gone is left alone and counted;
 *   - idempotent: the rows it writes carry roleFit, so a second run lists none;
 *   - a failed batch is reported (`failed`, `errors`, `ok: false`), its rows are NOT counted as rescored, and they stay stale so the next
 *     run retries them;
 *   - a dry run only counts: it loads no postings and writes nothing;
 *   - it is BOUNDED and RESUMABLE: `maxRows` stops it on a user boundary, `shouldStop` (a deadline) stops it between writes, and either
 *     way it returns a `nextCursor` (the last user it finished completely, ordered by user id). A re-run with that cursor lists only the
 *     users after it. Nothing is processed twice: a row already written carries roleFit and is no longer listed as stale, so even a user
 *     that was cut off half-way simply has fewer stale rows left, and the cursor never skips past it. A user skipped for having no base
 *     resume stays stale forever, which is why the cursor (not "stale only") is what moves a run past it.
 */
export interface StaleRow {
  userId: string;
  jobId: string;
}

export interface PostingForScoring {
  id: string;
  title: string;
  structuredJd: unknown;
  seniority: SeniorityLevel | string | null;
  open: boolean;
}

export interface RescoreDeps {
  /** Every match_scores row whose explanation has no `roleFit`, for users AFTER `afterUserId` (all users when null), ordered by user id. */
  listStaleRows(afterUserId: string | null): Promise<StaleRow[]>;
  loadBaseResume(userId: string): Promise<StructuredResume | null>;
  loadPostings(ids: string[]): Promise<PostingForScoring[]>;
  persist(userId: string, scored: ScoredJobLike[]): Promise<{ ok: boolean; persisted: number }>;
}

export interface RescoreSummary {
  ok: boolean;
  dryRun: boolean;
  staleRows: number;
  usersWithStaleRows: number;
  usersRescored: number;
  /** Stale rows that belong to a user with a base resume (what a real run would attempt, before dropping closed postings). */
  rowsToRescore: number;
  rowsRescored: number;
  skippedNoBaseResume: Array<{ userId: string; rows: number }>;
  skippedPostingGone: number;
  failed: number;
  errors: Array<{ userId: string; message: string }>;
  /** The last user this run finished completely; pass it back as `cursor` to carry on. Null once nothing is left after this run. */
  nextCursor: string | null;
  /** True when every user after the cursor was handled; false when `maxRows` or `shouldStop` ended the run early. */
  complete: boolean;
  stoppedBy: "maxRows" | "deadline" | null;
}

export interface RescoreOptions {
  dryRun: boolean;
  batchSize?: number;
  /** Stop before starting a user once this many stale rows have been handled (whole users only, so never half a user by this limit). */
  maxRows?: number;
  /** Resume after this user (the previous run's `nextCursor`). */
  cursor?: string | null;
  /** A deadline: asked before each user and each write. Return true to stop; the run reports a cursor and is not complete. */
  shouldStop?: () => boolean;
}

/** Rows per write: small enough that one failure costs little and the request stays well under any size limit. */
export const DEFAULT_RESCORE_BATCH_SIZE = 500;

export async function rescoreStale(deps: RescoreDeps, opts: RescoreOptions): Promise<RescoreSummary> {
  const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_RESCORE_BATCH_SIZE);
  const summary: RescoreSummary = {
    ok: true,
    dryRun: opts.dryRun,
    staleRows: 0,
    usersWithStaleRows: 0,
    usersRescored: 0,
    rowsToRescore: 0,
    rowsRescored: 0,
    skippedNoBaseResume: [],
    skippedPostingGone: 0,
    failed: 0,
    errors: [],
    nextCursor: null,
    complete: true,
    stoppedBy: null,
  };
  const cursorIn = opts.cursor ?? null;

  const stale = await deps.listStaleRows(cursorIn);
  summary.staleRows = stale.length;

  const byUser = new Map<string, string[]>();
  for (const { userId, jobId } of stale) {
    const ids = byUser.get(userId);
    if (ids) ids.push(jobId);
    else byUser.set(userId, [jobId]);
  }
  summary.usersWithStaleRows = byUser.size;

  let handledRows = 0;
  let lastFinished: string | null = cursorIn;
  let stopped: "maxRows" | "deadline" | null = null;
  for (const [userId, jobIds] of byUser) {
    if (opts.shouldStop?.()) {
      stopped = "deadline";
      break;
    }
    if (opts.maxRows !== undefined && handledRows >= opts.maxRows) {
      stopped = "maxRows";
      break;
    }
    handledRows += jobIds.length;
    let cutOff = false;
    try {
      const resume = await deps.loadBaseResume(userId);
      if (!resume) {
        summary.skippedNoBaseResume.push({ userId, rows: jobIds.length });
        lastFinished = userId;
        continue;
      }
      summary.rowsToRescore += jobIds.length;
      if (opts.dryRun) {
        lastFinished = userId;
        continue;
      }

      const postings = await deps.loadPostings(jobIds);
      const open = new Map(postings.filter((p) => p.open).map((p) => [p.id, p]));
      const scorable = jobIds.filter((id) => open.has(id));
      summary.skippedPostingGone += jobIds.length - scorable.length;

      let userFailed = false;
      for (let i = 0; i < scorable.length; i += batchSize) {
        if (i > 0 && opts.shouldStop?.()) {
          cutOff = true;
          break;
        }
        const batch = scorable.slice(i, i + batchSize);
        const scored: ScoredJobLike[] = batch.map((id) => {
          const p = open.get(id)!;
          const jd = p.structuredJd as { skills?: string[] } | null;
          const result = computeMatchScore(resume, jd?.skills ?? [], (p.seniority ?? undefined) as SeniorityLevel | undefined, p.title);
          return { job: { id }, score: result.score, tier: getMatchTier(result.score), explanation: result.explanation };
        });
        const written = await deps.persist(userId, scored);
        if (written.ok) summary.rowsRescored += written.persisted;
        else {
          userFailed = true;
          summary.failed++;
          summary.errors.push({ userId, message: `could not persist a batch of ${batch.length} score(s)` });
        }
      }
      if (!userFailed && !cutOff && scorable.length > 0) summary.usersRescored++;
    } catch (e) {
      summary.failed++;
      summary.errors.push({ userId, message: e instanceof Error ? e.message : String(e) });
    }
    if (cutOff) {
      // Half done: the cursor stays at the last user finished COMPLETELY, so the re-run lists this user's remaining stale rows.
      stopped = "deadline";
      break;
    }
    lastFinished = userId;
  }

  summary.stoppedBy = stopped;
  summary.complete = stopped === null;
  summary.nextCursor = stopped === null ? null : lastFinished;
  summary.ok = summary.failed === 0;
  return summary;
}
