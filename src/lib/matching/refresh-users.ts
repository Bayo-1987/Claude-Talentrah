import { computeMatchScore } from "./score";
import { getMatchTier } from "@/lib/match-tier";
import type { ScoredJobLike } from "./compute-and-store";
import type { StructuredResume } from "@/lib/resume/types";
import type { SeniorityLevel } from "@/lib/jobs/types";

/**
 * The per-user loop of the match-score refresh (refresh-job.ts), as a pure function over injected ports so it is tested without a database
 * (tests/matching/refresh-users.test.ts). Behaviour is the loop the job always had; what it gains is a DEADLINE, because the refresh now also
 * runs at the end of the ingest route (post-ingest-refresh.ts) inside that route's time budget:
 *
 *   - gap-driven: it scores exactly the (user, posting) pairs that have no stored row. That covers a NEW posting and a posting whose scores
 *     were deleted because its JD or seniority changed (trigger 0069); a second run scores nothing;
 *   - bounded: `shouldStop` is asked before EACH user, so it stops on a user boundary, never in the middle of one, and says
 *     `complete: false` / `stoppedBy: "deadline"`; a re-run (the daily 16:00 refresh, or the next ingest) does only what is left;
 *   - failure-isolated: one user's failure is counted and does not stop the others.
 */
export interface ScorableJobPosting {
  id: string;
  /** A2: the title is what the role-family check classifies. */
  title: string;
  structuredJd: unknown;
  seniority: SeniorityLevel | null;
  organizationId: string | null;
}

export interface RefreshUsersDeps {
  /** The posting ids this user already has a stored score for. */
  scoredPostingIds(userId: string): Promise<Set<string>>;
  /** The user's base resume content, or null when it was deleted/unset since the candidate query. */
  loadBaseResume(userId: string): Promise<StructuredResume | null>;
  persist(userId: string, scored: ScoredJobLike[]): Promise<{ persisted: number; ok: boolean }>;
}

export interface RefreshUsersResult {
  usersUpToDate: number;
  usersRefreshed: number;
  /** Rows written: one per (user, posting) pair. */
  postingsScored: number;
  /** Distinct postings that gained a score for at least one user. */
  distinctPostingsScored: number;
  failed: number;
  errors: Array<{ userId: string; message: string }>;
  /** False only when `shouldStop` ended the run early. */
  complete: boolean;
  stoppedBy: "deadline" | null;
}

export async function refreshUsers(
  deps: RefreshUsersDeps,
  eligible: ScorableJobPosting[],
  userIds: string[],
  opts: { shouldStop?: () => boolean } = {},
): Promise<RefreshUsersResult> {
  const result: RefreshUsersResult = {
    usersUpToDate: 0,
    usersRefreshed: 0,
    postingsScored: 0,
    distinctPostingsScored: 0,
    failed: 0,
    errors: [],
    complete: true,
    stoppedBy: null,
  };
  const touched = new Set<string>();

  for (const userId of userIds) {
    if (opts.shouldStop?.()) {
      result.complete = false;
      result.stoppedBy = "deadline";
      break;
    }
    try {
      // Cheap existence check BEFORE fetching this user's (potentially large) resume content: the common case is full coverage.
      const scoredIds = await deps.scoredPostingIds(userId);
      const missing = eligible.filter((p) => !scoredIds.has(p.id));
      if (missing.length === 0) {
        result.usersUpToDate++;
        continue;
      }

      const resume = await deps.loadBaseResume(userId);
      // The base resume was deleted/unset since the candidate-user query: nothing to score against, not a failure.
      if (!resume) {
        result.usersUpToDate++;
        continue;
      }

      // Same three-line body as scoreJobs (compute-and-store.ts), not a call to it: this job only has the lightweight id/structured_jd/
      // seniority columns, not a full JobPosting row. computeMatchScore itself, the shared pure primitive, is untouched.
      const scored: ScoredJobLike[] = missing.map((job) => {
        const structuredJd = job.structuredJd as { skills?: string[] } | null;
        const score = computeMatchScore(resume, structuredJd?.skills ?? [], job.seniority ?? undefined, job.title);
        return { job: { id: job.id }, score: score.score, tier: getMatchTier(score.score), explanation: score.explanation };
      });

      const written = await deps.persist(userId, scored);
      if (!written.ok) {
        result.failed++;
        result.errors.push({ userId, message: "could not persist scores (see server log)" });
        continue;
      }
      result.usersRefreshed++;
      result.postingsScored += written.persisted;
      for (const s of scored) touched.add(s.job.id);
    } catch (err) {
      result.failed++;
      result.errors.push({ userId, message: err instanceof Error ? err.message : String(err) });
      console.error(`[match-score-refresh] failed for user ${userId}:`, err);
    }
  }

  result.distinctPostingsScored = touched.size;
  return result;
}
