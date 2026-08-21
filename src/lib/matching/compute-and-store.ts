import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeMatchScore } from "./score";
import { getMatchTier } from "@/lib/match-tier";
import type { Database, Tables } from "@/lib/supabase/types";
import type { StructuredResume } from "@/lib/resume/types";

type JobPosting = Tables<"job_postings">;

export interface ScoredJob {
  job: JobPosting;
  score: number;
  tier: ReturnType<typeof getMatchTier>;
}

/**
 * Computes match scores for a user against a set of jobs and upserts them
 * into match_scores as a cache (build-prompt §7: "computed score +
 * explanation breakdown per user↔job pair"). Cheap enough to run on every
 * feed load at Phase 1 scale — recomputing is the source of truth, the table
 * is a cache other reads (e.g. the Job Tracker) can use without recomputing.
 */
export async function computeAndStoreMatchScores(
  supabase: SupabaseClient<Database>,
  userId: string,
  resume: StructuredResume,
  jobs: JobPosting[],
): Promise<ScoredJob[]> {
  const scored = jobs.map((job) => {
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

  if (scored.length > 0) {
    await supabase.from("match_scores").upsert(
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
  }

  return scored;
}
