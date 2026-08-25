import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
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
    const admin = createServiceRoleClient();
    await admin.from("match_scores").upsert(
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
