import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface OwnVerificationState {
  status: string;
  score: number | null;
  verifiedAt: string | null;
  optIn: boolean;
  availableForHire: boolean;
  remoteReady: boolean;
  earliestStartDate: string | null;
}

export async function getOwnVerificationState(userId: string): Promise<OwnVerificationState | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "talent_verification_status, talent_verification_score, talent_verified_at, talent_directory_opt_in, talent_available_for_hire, talent_remote_ready, talent_earliest_start_date",
    )
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    status: data.talent_verification_status,
    score: data.talent_verification_score,
    verifiedAt: data.talent_verified_at,
    optIn: data.talent_directory_opt_in,
    availableForHire: data.talent_available_for_hire,
    remoteReady: data.talent_remote_ready,
    earliestStartDate: data.talent_earliest_start_date,
  };
}

export interface VerificationHistoryEntry {
  id: string;
  status: string;
  score: number | null;
  feedback: string | null;
  requestedAt: string;
  decidedAt: string | null;
}

export async function getVerificationHistory(userId: string): Promise<VerificationHistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("talent_verifications")
    .select("id, status, ai_score, ai_feedback, requested_at, decided_at")
    .eq("user_id", userId)
    .order("requested_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    status: r.status,
    score: r.ai_score,
    feedback: r.ai_feedback,
    requestedAt: r.requested_at,
    decidedAt: r.decided_at,
  }));
}

export interface PortfolioItem {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
}

export async function getOwnPortfolioItems(userId: string): Promise<PortfolioItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("talent_portfolio_items")
    .select("id, title, description, url")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/* ---------------------------------------------------------------------- *
 * Employer-facing reads — both go through the SECURITY DEFINER functions
 * (0135), never a direct table query. Their own entitlement check (an
 * active subscription for the caller's org) means a caller with no
 * subscription gets an empty result here, not an error — same behaviour the
 * functions themselves implement.
 * ---------------------------------------------------------------------- */

export interface DirectoryCandidate {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  country: string | null;
  availableForHire: boolean;
  remoteReady: boolean;
  earliestStartDate: string | null;
  verificationScore: number | null;
  verifiedAt: string | null;
}

export async function searchTalentDirectory(filters: {
  remoteReady?: boolean;
  availableForHire?: boolean;
  limit?: number;
  offset?: number;
  /** Looks up exactly one candidate — the same entitlement + verified+opt-in gate, reused rather than a second read path. See talent_directory_search's own header. */
  candidateId?: string;
}): Promise<DirectoryCandidate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("talent_directory_search", {
    p_remote_ready: filters.remoteReady,
    p_available_for_hire: filters.availableForHire,
    p_limit: filters.limit ?? 20,
    p_offset: filters.offset ?? 0,
    p_candidate_id: filters.candidateId,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    userId: r.user_id,
    firstName: r.first_name,
    lastName: r.last_name,
    country: r.country,
    availableForHire: r.available_for_hire,
    remoteReady: r.remote_ready,
    earliestStartDate: r.earliest_start_date,
    verificationScore: r.verification_score,
    verifiedAt: r.verified_at,
  }));
}

export async function getCandidatePortfolioItems(candidateId: string): Promise<PortfolioItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("talent_directory_portfolio_items", {
    p_candidate_id: candidateId,
  });
  if (error) throw error;
  return data ?? [];
}

export interface OrgSubscriptionState {
  status: string;
  expiresAt: string;
  planName: string;
  autoRenewStatus: string | null;
}

export async function getOrgSubscription(organizationId: string): Promise<OrgSubscriptionState | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("talent_directory_subscriptions")
    .select("status, expires_at, auto_renew_status, talent_directory_plans(name)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    status: data.status,
    expiresAt: data.expires_at,
    planName: data.talent_directory_plans?.name ?? "Local Sourcing",
    autoRenewStatus: data.auto_renew_status,
  };
}
