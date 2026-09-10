import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * All three reads go through the AUTHENTICATED client, not service role —
 * each is a SECURITY DEFINER function (0142) that re-derives the caller's
 * own identity from auth.uid() and returns an empty result for an
 * ineligible caller rather than an error, same style talent_directory_search
 * (0135) already established.
 */

export interface ReviewQueueItem {
  id: string;
  requestedAt: string;
  targetRole: string | null;
  targetIndustry: string | null;
  expertiseMatch: boolean;
}

export async function getReviewQueue(limit = 20): Promise<ReviewQueueItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("talent_verification_review_queue", { p_limit: limit });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    requestedAt: r.requested_at,
    targetRole: r.target_role,
    targetIndustry: r.target_industry,
    expertiseMatch: r.expertise_match,
  }));
}

export interface MyClaimedReview {
  id: string;
  requestedAt: string;
  claimedAt: string;
  targetRole: string | null;
  targetIndustry: string | null;
}

export async function getMyClaimedReviews(): Promise<MyClaimedReview[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("talent_verification_my_claims");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    requestedAt: r.requested_at,
    claimedAt: r.claimed_at,
    targetRole: r.target_role,
    targetIndustry: r.target_industry,
  }));
}

export interface ReviewDetail {
  id: string;
  status: string;
  targetRole: string | null;
  targetIndustry: string | null;
  requestedAt: string;
  candidateId: string;
  candidateFirstName: string | null;
  candidateLastName: string | null;
  /** The same structured resume shape verification-runner.ts's AI grader consumes. */
  resume: unknown;
}

export async function getReviewDetail(verificationId: string): Promise<ReviewDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("talent_verification_review_detail", {
    p_verification_id: verificationId,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    targetRole: row.target_role,
    targetIndustry: row.target_industry,
    requestedAt: row.requested_at,
    candidateId: row.candidate_id,
    candidateFirstName: row.candidate_first_name,
    candidateLastName: row.candidate_last_name,
    resume: row.resume,
  };
}
