import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { chunkInList } from "@/lib/supabase/in-list";
import { persistScoresOrRetryStale } from "./refresh-job";
import {
  rescoreStale,
  verifyRescoredSample,
  type PostingForScoring,
  type RescoreDeps,
  type RescoreOptions,
  type RescoreSummary,
  type VerifyDeps,
  type VerifyResult,
} from "./rescore-stale";
import type { StructuredResume } from "@/lib/resume/types";

/**
 * The real ports for rescore-stale.ts, over the service-role client. Nothing here writes except `persist`, which reuses the refresh
 * job's own upsert (it recovers from a posting deleted mid-run and reports a real failure rather than swallowing it).
 */
function realDeps(): RescoreDeps {
  const admin = createServiceRoleClient();
  return {
    async listStaleRows(afterUserId) {
      const rows: Array<{ userId: string; jobId: string; score: number; explanation: unknown }> = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        let q = admin
          .from("match_scores")
          .select("user_id, job_posting_id, score, explanation")
          // A stored explanation from before A2 has no roleFit key.
          .filter("explanation->roleFit", "is", null);
        if (afterUserId) q = q.gt("user_id", afterUserId);
        const { data, error } = await q
          .order("user_id")
          .order("job_posting_id")
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`could not list stale rows: ${error.message}`);
        for (const r of data ?? []) rows.push({ userId: r.user_id, jobId: r.job_posting_id, score: r.score, explanation: r.explanation });
        if (!data || data.length < PAGE) break;
      }
      return rows;
    },
    async loadBaseResume(userId) {
      const { data, error } = await admin.from("resumes").select("structured_content").eq("user_id", userId).eq("is_base", true).maybeSingle();
      if (error) throw new Error(`could not load the base resume: ${error.message}`);
      return (data?.structured_content as unknown as StructuredResume | null) ?? null;
    },
    async loadPostings(ids) {
      const out: PostingForScoring[] = [];
      for (const chunk of chunkInList(ids)) {
        // 0202: a superseded duplicate is hidden everywhere and the refresh never scores it, so the rescore leaves its stale row alone too
        // (it is not returned here, so the pure job counts it with the postings that are gone). tests/jobs/supersession-read-paths.test.ts.
        const { data, error } = await admin
          .from("job_postings")
          .select("id, title, structured_jd, seniority, status")
          .is("superseded_at", null)
          .in("id", chunk);
        if (error) throw new Error(`could not load postings: ${error.message}`);
        for (const p of data ?? []) out.push({ id: p.id, title: p.title, structuredJd: p.structured_jd, seniority: p.seniority, open: p.status === "open" });
      }
      return out;
    },
    async persist(userId, scored) {
      return persistScoresOrRetryStale(admin, userId, scored);
    },
  };
}

export function runRescoreStaleJob(opts: RescoreOptions): Promise<RescoreSummary> {
  return rescoreStale(realDeps(), opts);
}

/** The read-only ports for the post-run verification: a random sample of rows that DO carry roleFit, recomputed and compared. */
function realVerifyDeps(): VerifyDeps {
  const admin = createServiceRoleClient();
  const base = realDeps();
  return {
    async listRescoredRows() {
      // Ids only (cheap); the random choice is made in memory by the pure function.
      const rows: Array<{ userId: string; jobId: string }> = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("match_scores")
          .select("user_id, job_posting_id")
          .not("explanation->roleFit", "is", null)
          .order("user_id")
          .order("job_posting_id")
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`could not list rescored rows: ${error.message}`);
        for (const r of data ?? []) rows.push({ userId: r.user_id, jobId: r.job_posting_id });
        if (!data || data.length < PAGE) break;
      }
      return rows;
    },
    async loadRows(sample) {
      const out: Array<{ userId: string; jobId: string; score: number; tier: string; explanation: unknown }> = [];
      for (const { userId, jobId } of sample) {
        const { data, error } = await admin
          .from("match_scores")
          .select("score, tier, explanation")
          .eq("user_id", userId)
          .eq("job_posting_id", jobId)
          .maybeSingle();
        if (error) throw new Error(`could not load a sampled row: ${error.message}`);
        if (data) out.push({ userId, jobId, score: data.score, tier: data.tier, explanation: data.explanation });
      }
      return out;
    },
    loadBaseResume: base.loadBaseResume,
    loadPostings: base.loadPostings,
  };
}

export function runVerifyRescoredSample(n: number): Promise<VerifyResult> {
  return verifyRescoredSample(realVerifyDeps(), n);
}
