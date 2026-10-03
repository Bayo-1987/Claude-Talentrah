import { computeMatchScore } from "./score";
import { describeMatchConfidence, getMatchTier } from "@/lib/match-tier";
import type { ScoredJobLike } from "./compute-and-store";
import type { StructuredResume } from "@/lib/resume/types";
import type { SeniorityLevel } from "@/lib/jobs/types";

/**
 * The stale-only rescore (follows A2, tests/matching/rescore-stale*.test.ts).
 *
 * A2 caps a match score when it is COMPUTED (role-fit.ts), so every row `match_scores` already holds was computed under the old rules and
 * carries no `explanation.roleFit`. The feed and the job page recompute what they render, but the readers that do not (the Auto-Apply review
 * page, employer ranking, the digest and alerts when their flags are on) would read old and new values side by side. This rescoring touches
 * exactly the rows without `roleFit`, for users who have a base resume, and nothing else.
 *
 * Pure orchestration over injected ports (rescore-stale-job.ts supplies the real ones), so the behaviour is tested without a database:
 *   - only stale rows are listed, loaded and written; it writes ONLY match_scores rows (tests/matching/rescore-writes-only-scores.test.ts);
 *   - a user with no base resume is skipped and LISTED (nothing to score against);
 *   - a stale row whose posting is closed, superseded or gone is left alone and counted;
 *   - a posting that still carries the STUB enrichment skill is left alone and counted on its own (it gets a clean score after the next ingest
 *     overwrites it): the stub wrote a fixed fake skill into real postings while `ingest_llm_enrichment` was on;
 *   - idempotent: written rows carry roleFit, so a second run lists none;
 *   - a failed batch is reported (`failed`, `errors`, `ok: false`), its rows are NOT counted as rescored, and they stay stale for the next run;
 *   - BOUNDED and RESUMABLE: `maxRows` stops on a USER boundary, `shouldStop` (a deadline) stops between writes, either way it returns a
 *     `nextCursor` (the last user finished completely, ordered by user id). A user whose rows exceed `maxRows` is processed WHOLE (the limit is
 *     only checked before a user is started, so a big user is never starved); inside the deadline their writes are `batchSize` rows each;
 *   - the DRY RUN computes the new scores read-only (it loads resumes and postings, it writes nothing) so it can report the SHAPE of the change
 *     (`shape`): what the owner approves before the write run.
 */
export interface StaleRow {
  userId: string;
  jobId: string;
  /** The stored score and explanation: what the feed shows today, so the shape can say how it would change. */
  score: number;
  explanation: unknown;
}

export interface PostingForScoring {
  id: string;
  title: string;
  structuredJd: unknown;
  seniority: SeniorityLevel | string | null;
  open: boolean;
}

/** The fixed skill the offline stub enrichment provider returns (src/lib/llm/jd-extraction/stub-provider.ts; a test pins them equal). */
export const STUB_ENRICHMENT_SKILL = "stub-jd-extraction-skill";

export function carriesStubSkill(structuredJd: unknown): boolean {
  const skills = (structuredJd as { skills?: unknown } | null)?.skills;
  return Array.isArray(skills) && skills.includes(STUB_ENRICHMENT_SKILL);
}

export interface RescoreDeps {
  /** Every match_scores row whose explanation has no `roleFit`, for users AFTER `afterUserId` (all users when null), ordered by user id. */
  listStaleRows(afterUserId: string | null): Promise<StaleRow[]>;
  loadBaseResume(userId: string): Promise<StructuredResume | null>;
  loadPostings(ids: string[]): Promise<PostingForScoring[]>;
  persist(userId: string, scored: ScoredJobLike[]): Promise<{ ok: boolean; persisted: number }>;
}

/** What the feed shows for a score: a tier name, "none" under 60, or "unscreened" with no screenable tags. */
export type FeedLabel = "excellent" | "good" | "fair" | "none" | "unscreened";

export function feedLabel(score: number, explanation: unknown): FeedLabel {
  const d = describeMatchConfidence(score, explanation);
  return d.tier ?? (d.isUnscreened ? "unscreened" : "none");
}

export interface RescoreShape {
  /** Rows whose new score was computed in this call (the rows that are, or would be, written). */
  rows: number;
  up: number;
  down: number;
  same: number;
  /** Absolute size of the change, for rows whose score changed. */
  changeBuckets: { "1-5": number; "6-10": number; "11-20": number; over20: number };
  /** "from -> to" in the labels the feed uses, for rows whose label changes. */
  labelChanges: Record<string, number>;
  labelUnchanged: number;
  /** Rows that would end with no tier shown (under 60) / unscreened (no screenable tags). */
  endingNoTier: number;
  endingUnscreened: number;
  /** Rows per user, largest first. No user ids. */
  rowsPerUserRanked: number[];
  /** The ten largest drops, as numbers only. */
  largestDrops: Array<{ from: number; to: number }>;
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
  /** Stale rows on a posting that still carries the stub enrichment skill. */
  skippedStubSkill: number;
  failed: number;
  errors: Array<{ userId: string; message: string }>;
  /** The last user this run finished completely; pass it back as `cursor` to carry on. Null once nothing is left after this run. */
  nextCursor: string | null;
  /** True when every user after the cursor was handled; false when `maxRows` or `shouldStop` ended the run early. */
  complete: boolean;
  stoppedBy: "maxRows" | "deadline" | null;
  shape: RescoreShape;
}

export interface RescoreOptions {
  dryRun: boolean;
  batchSize?: number;
  /** Stop before starting a user once this many stale rows have been handled (whole users only: a user above the limit is processed whole). */
  maxRows?: number;
  /** Resume after this user (the previous run's `nextCursor`). */
  cursor?: string | null;
  /** A deadline: asked before each user and each write. Return true to stop; the run reports a cursor and is not complete. */
  shouldStop?: () => boolean;
}

/** Rows per write: small enough that one failure costs little and the request stays well under any size limit. */
export const DEFAULT_RESCORE_BATCH_SIZE = 500;

function emptyShape(): RescoreShape {
  return {
    rows: 0,
    up: 0,
    down: 0,
    same: 0,
    changeBuckets: { "1-5": 0, "6-10": 0, "11-20": 0, over20: 0 },
    labelChanges: {},
    labelUnchanged: 0,
    endingNoTier: 0,
    endingUnscreened: 0,
    rowsPerUserRanked: [],
    largestDrops: [],
  };
}

function recordShape(shape: RescoreShape, old: StaleRow, next: ScoredJobLike) {
  shape.rows++;
  const delta = next.score - old.score;
  if (delta > 0) shape.up++;
  else if (delta < 0) shape.down++;
  else shape.same++;
  const size = Math.abs(delta);
  if (size > 0) {
    if (size <= 5) shape.changeBuckets["1-5"]++;
    else if (size <= 10) shape.changeBuckets["6-10"]++;
    else if (size <= 20) shape.changeBuckets["11-20"]++;
    else shape.changeBuckets.over20++;
  }
  const from = feedLabel(old.score, old.explanation);
  const to = feedLabel(next.score, next.explanation);
  if (from === to) shape.labelUnchanged++;
  else shape.labelChanges[`${from} -> ${to}`] = (shape.labelChanges[`${from} -> ${to}`] ?? 0) + 1;
  if (to === "none") shape.endingNoTier++;
  if (to === "unscreened") shape.endingUnscreened++;
  if (delta < 0) {
    shape.largestDrops.push({ from: old.score, to: next.score });
    shape.largestDrops.sort((a, b) => b.from - b.to - (a.from - a.to));
    if (shape.largestDrops.length > 10) shape.largestDrops.length = 10;
  }
}

function scoreRow(resume: StructuredResume, p: PostingForScoring): ScoredJobLike {
  const jd = p.structuredJd as { skills?: string[] } | null;
  const result = computeMatchScore(resume, jd?.skills ?? [], (p.seniority ?? undefined) as SeniorityLevel | undefined, p.title);
  return { job: { id: p.id }, score: result.score, tier: getMatchTier(result.score), explanation: result.explanation };
}

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
    skippedStubSkill: 0,
    failed: 0,
    errors: [],
    nextCursor: null,
    complete: true,
    stoppedBy: null,
    shape: emptyShape(),
  };
  const cursorIn = opts.cursor ?? null;
  const perUserRows: number[] = [];

  const stale = await deps.listStaleRows(cursorIn);
  summary.staleRows = stale.length;

  const byUser = new Map<string, StaleRow[]>();
  for (const row of stale) {
    const list = byUser.get(row.userId);
    if (list) list.push(row);
    else byUser.set(row.userId, [row]);
  }
  summary.usersWithStaleRows = byUser.size;

  let handledRows = 0;
  let lastFinished: string | null = cursorIn;
  let stopped: "maxRows" | "deadline" | null = null;
  for (const [userId, userRows] of byUser) {
    if (opts.shouldStop?.()) {
      stopped = "deadline";
      break;
    }
    // Checked only BEFORE a user is started, so a user above maxRows is processed whole and is never starved.
    if (opts.maxRows !== undefined && handledRows >= opts.maxRows) {
      stopped = "maxRows";
      break;
    }
    handledRows += userRows.length;
    let cutOff = false;
    try {
      const resume = await deps.loadBaseResume(userId);
      if (!resume) {
        summary.skippedNoBaseResume.push({ userId, rows: userRows.length });
        lastFinished = userId;
        continue;
      }
      summary.rowsToRescore += userRows.length;

      const postings = await deps.loadPostings(userRows.map((r) => r.jobId));
      const open = new Map(postings.filter((p) => p.open).map((p) => [p.id, p]));
      const stubbed = userRows.filter((r) => open.has(r.jobId) && carriesStubSkill(open.get(r.jobId)!.structuredJd));
      summary.skippedStubSkill += stubbed.length;
      const scorable = userRows.filter((r) => open.has(r.jobId) && !carriesStubSkill(open.get(r.jobId)!.structuredJd));
      summary.skippedPostingGone += userRows.length - scorable.length - stubbed.length;

      const scored = scorable.map((row) => ({ row, next: scoreRow(resume, open.get(row.jobId)!) }));
      if (opts.dryRun) {
        for (const s of scored) recordShape(summary.shape, s.row, s.next);
        if (scored.length > 0) perUserRows.push(scored.length);
        lastFinished = userId;
        continue;
      }

      let userFailed = false;
      for (let i = 0; i < scored.length; i += batchSize) {
        if (i > 0 && opts.shouldStop?.()) {
          cutOff = true;
          break;
        }
        const batch = scored.slice(i, i + batchSize);
        const written = await deps.persist(userId, batch.map((b) => b.next));
        if (written.ok) {
          summary.rowsRescored += written.persisted;
          for (const b of batch) recordShape(summary.shape, b.row, b.next);
        } else {
          userFailed = true;
          summary.failed++;
          summary.errors.push({ userId, message: `could not persist a batch of ${batch.length} score(s)` });
        }
      }
      if (scored.length > 0) perUserRows.push(scored.length);
      if (!userFailed && !cutOff && scored.length > 0) summary.usersRescored++;
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

  summary.shape.rowsPerUserRanked = perUserRows.sort((a, b) => b - a);
  summary.stoppedBy = stopped;
  summary.complete = stopped === null;
  summary.nextCursor = stopped === null ? null : lastFinished;
  summary.ok = summary.failed === 0;
  return summary;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Verifying a random sample AFTER the write run (counts only): recompute each sampled row from its inputs and compare it to what is stored.
// ---------------------------------------------------------------------------------------------------------------------------------------

export interface VerifyDeps {
  listRescoredRows(): Promise<Array<{ userId: string; jobId: string }>>;
  loadRows(rows: Array<{ userId: string; jobId: string }>): Promise<Array<{ userId: string; jobId: string; score: number; tier: string; explanation: unknown }>>;
  loadBaseResume(userId: string): Promise<StructuredResume | null>;
  loadPostings(ids: string[]): Promise<PostingForScoring[]>;
}

export interface VerifyResult {
  checked: number;
  matching: number;
  mismatching: number;
  /** Sampled rows that could not be recomputed (no base resume now, or the posting is closed or gone). */
  unverifiable: number;
}

export async function verifyRescoredSample(deps: VerifyDeps, n: number, random: () => number = Math.random): Promise<VerifyResult> {
  const all = await deps.listRescoredRows();
  // Fisher-Yates over a copy, then the first n: a uniform sample without replacement.
  const pool = [...all];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const sample = pool.slice(0, Math.max(0, n));
  const result: VerifyResult = { checked: sample.length, matching: 0, mismatching: 0, unverifiable: 0 };
  if (sample.length === 0) return result;

  const stored = await deps.loadRows(sample);
  const postings = new Map((await deps.loadPostings([...new Set(stored.map((r) => r.jobId))])).filter((p) => p.open).map((p) => [p.id, p]));
  const resumes = new Map<string, StructuredResume | null>();
  for (const row of stored) {
    if (!resumes.has(row.userId)) resumes.set(row.userId, await deps.loadBaseResume(row.userId));
    const resume = resumes.get(row.userId);
    const posting = postings.get(row.jobId);
    if (!resume || !posting) {
      result.unverifiable++;
      continue;
    }
    const fresh = scoreRow(resume, posting);
    const storedRoleFit = (row.explanation as { roleFit?: string } | null)?.roleFit;
    const freshRoleFit = (fresh.explanation as { roleFit?: string }).roleFit;
    if (fresh.score === row.score && fresh.tier === row.tier && freshRoleFit === storedRoleFit) result.matching++;
    else result.mismatching++;
  }
  result.unverifiable += sample.length - stored.length;
  return result;
}
