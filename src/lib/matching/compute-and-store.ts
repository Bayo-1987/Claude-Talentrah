import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { computeMatchScore } from "./score";
import { getMatchTier } from "@/lib/match-tier";
import type { Database, Tables } from "@/lib/supabase/types";
import type { StructuredResume } from "@/lib/resume/types";
import type { MatchExplanation } from "./score";

// See skill-facet.ts's identical alias for why this is Omit, not the full row.
type JobPosting = Omit<Tables<"job_postings">, "description_preview">;

export interface ScoredJob {
  job: JobPosting;
  score: number;
  tier: ReturnType<typeof getMatchTier>;
  /**
   * Already computed for the score and already written to the cache — exposed
   * so the card's Vet actions can answer from it without a model call. It was
   * being discarded on the way out, which is why "Am I a fit?" looked like it
   * needed new AI when it did not.
   */
  explanation: MatchExplanation;
}

/**
 * Computes match scores for a user against a set of jobs and upserts them
 * into match_scores as a cache (build-prompt §7: "computed score +
 * explanation breakdown per user↔job pair"). Cheap enough to run on every
 * feed load at Phase 1 scale — recomputing is the source of truth, the table
 * is a cache other reads (e.g. the Job Tracker) can use without recomputing.
 *
 * The CACHE WRITE goes through the service role, not the caller's client
 * (migration 0031). The score is this server's conclusion about a user, not
 * something the user supplies — and while the caller's client could write it
 * under the owner-only policy, so could the user, directly. Phase 2's
 * Auto-Apply is specced to gate on a match threshold, so a user-writable
 * score would be a user-writable trigger for applications sent in their name.
 *
 * The caller still passes its own client: it is what READ the jobs, and
 * keeping the read path on the user's session means RLS still decides which
 * postings they can be scored against (0027's verification gate, for one).
 * Only the write is elevated.
 */
export async function computeAndStoreMatchScores(
  supabase: SupabaseClient<Database>,
  userId: string,
  resume: StructuredResume,
  jobs: JobPosting[],
): Promise<ScoredJob[]> {
  const scored = scoreJobs(resume, jobs);
  await persistMatchScores(userId, scored);
  return scored;
}

/**
 * The scoring itself — pure, synchronous, no database.
 *
 * SPLIT OUT BECAUSE THE FEED WAS WAITING ON A WRITE IT DOES NOT READ. This
 * is the entire array `/jobs` renders, and it is complete before the upsert
 * below has even been issued: the cards, their scores and their
 * explanations all come from here. Awaiting the persistence before
 * rendering therefore held the response open for a write whose result never
 * reaches the page. `/jobs` now calls this directly and hands the
 * persistence to `after()`.
 *
 * Named `scoreJobs`, not `computeMatchScores`, to keep it clearly distinct
 * from `computeMatchScore` (singular) in ./score, which is the per-job
 * primitive this loops over.
 */
export function scoreJobs(resume: StructuredResume, jobs: JobPosting[]): ScoredJob[] {
  return jobs.map((job) => {
    const structuredJd = job.structured_jd as { skills?: string[] } | null;
    const result = computeMatchScore(
      resume,
      structuredJd?.skills ?? [],
      job.seniority ?? undefined,
    );
    return {
      job,
      score: result.score,
      tier: getMatchTier(result.score),
      explanation: result.explanation,
    };
  });
}

/**
 * Writes the cache. The elevated half — see the note on
 * `computeAndStoreMatchScores` above for why the write uses the service role
 * while the read that produced these jobs used the caller's session.
 *
 * SAFE TO RUN AFTER THE RESPONSE, and the reason is worth being precise
 * about, because "it's only a cache" is not on its own a good enough
 * argument when Auto-Apply gates on this table. Two things make it hold:
 * the scores written here are computed by this server from a resume and a
 * posting, so nothing a client said can reach them; and the one consumer
 * that must see them fresh — `scanAndQueue` — is sequenced after this call
 * inside the same `after()` callback rather than racing it. What a deferred
 * write does change is that a reader of `match_scores` DURING the same
 * request sees the previous visit's values; `/jobs` documents the two
 * places that applies (the promoted-slot join and the pending-queue count).
 *
 * Errors are logged, not thrown. In `after()` there is no response left to
 * fail, and an unhandled rejection there would be a crash report for a
 * cache miss.
 */
export async function persistMatchScores(userId: string, scored: ScoredJob[]): Promise<void> {
  if (scored.length === 0) return;
  const admin = createServiceRoleClient();
  const { error } = await admin.from("match_scores").upsert(
    scored.map((s) => ({
      user_id: userId,
      job_posting_id: s.job.id,
      score: s.score,
      tier: s.tier,
      explanation: JSON.parse(JSON.stringify(s.explanation)),
      computed_at: new Date().toISOString(),
    })),
    { onConflict: "user_id,job_posting_id" },
  );
  if (error) {
    console.error(`[matching] could not persist ${scored.length} score(s) for ${userId}: ${error.message}`);
  }
}
