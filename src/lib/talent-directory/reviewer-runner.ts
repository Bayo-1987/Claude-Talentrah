import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * The reviewer-side half of 0141/0142's human review tier — plain functions
 * taking a trusted reviewerId, same split runTalentVerification (verification-runner.ts)
 * already uses so these are callable directly from tests without
 * requireUser()'s cookie dependency (tests/talent-directory/reviewer-claim-race.test.ts
 * cannot call requireUser() at all, same reason verification-race.test.ts
 * can't).
 *
 * Every RPC here is service_role-only (0142's own header) — the calling
 * Server Action (reviewer-actions.ts) is the trusted boundary that resolves
 * the reviewer's id via requireUser()'s own session lookup before handing it
 * in, exactly the shape book_mentor_session/mark_mentor_session_confirmed
 * already use.
 */

export interface ClaimReviewResult {
  ok: boolean;
  reason: "ok" | "NOT_ELIGIBLE_REVIEWER" | "ALREADY_CLAIMED" | "CANNOT_REVIEW_OWN_SUBMISSION" | "error";
}

export async function claimVerificationReview(reviewerId: string, verificationId: string): Promise<ClaimReviewResult> {
  const serviceClient = createServiceRoleClient();
  const { data, error } = await serviceClient.rpc("claim_talent_verification_review", {
    p_reviewer_id: reviewerId,
    p_verification_id: verificationId,
  });
  if (error || !data?.[0]) return { ok: false, reason: "error" };
  return { ok: data[0].ok, reason: data[0].reason as ClaimReviewResult["reason"] };
}

export async function releaseVerificationReviewClaim(reviewerId: string, verificationId: string): Promise<boolean> {
  const serviceClient = createServiceRoleClient();
  const { data, error } = await serviceClient.rpc("release_talent_verification_review_claim", {
    p_reviewer_id: reviewerId,
    p_verification_id: verificationId,
  });
  if (error) return false;
  return Boolean(data);
}

export interface ReviewDecisionResult {
  status: "success" | "error";
  message: string;
}

/**
 * The reviewer's decision. Resolves through the SAME resolve_talent_verification()
 * (0135, extended by 0142) runTalentVerification's AI path already uses —
 * passing p_reviewer_id is what selects the human-path branch inside that
 * function (status='claimed' + reviewer_id match, rather than AI's
 * status='pending'), and is also what makes resolve_talent_verification
 * compute and record reviewer_payout_ngn, once, at this exact moment (see
 * that function's own header for why the payout formula lives in SQL, not
 * here).
 */
export async function resolveVerificationReview(
  reviewerId: string,
  verificationId: string,
  candidateId: string,
  verified: boolean,
  notes: string,
): Promise<ReviewDecisionResult> {
  const serviceClient = createServiceRoleClient();
  const { data: ok, error } = await serviceClient.rpc("resolve_talent_verification", {
    p_verification_id: verificationId,
    p_user_id: candidateId,
    p_verified: verified,
    // Human review has no numeric AI score — null is honest here rather
    // than inventing one, and profiles.talent_verification_score already
    // allows null (0135). The generated Args type marks p_score/p_feedback
    // as non-nullable because the SQL function declares them with no
    // DEFAULT, not because Postgres actually rejects a null argument for a
    // plain integer/text parameter — same known generated-type gap as
    // promoted.ts's own `as never` casts.
    p_score: null as never,
    p_feedback: (notes.trim() || null) as never,
    p_reviewer_id: reviewerId,
    p_reviewer_notes: notes.trim() || undefined,
  });

  if (error || !ok) {
    return {
      status: "error",
      message: "Could not record that decision — the claim may have been released or already decided.",
    };
  }

  return {
    status: "success",
    message: verified ? "Marked verified." : "Marked not verified.",
  };
}
