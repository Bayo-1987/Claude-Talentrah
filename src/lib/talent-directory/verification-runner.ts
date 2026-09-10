import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { spendCredits, InsufficientCreditsError } from "@/lib/credits/spend";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { gradeResumeForVerification } from "./verification";

/**
 * The actual credit-gated verification flow, extracted from
 * requestTalentVerificationAction (actions.ts) so it can be called directly
 * with a trusted userId — by the Server Action (which resolves that id via
 * requireUser()'s own session lookup) and by
 * tests/talent-directory/verification-race.test.ts (which cannot call
 * requireUser() at all, since `cookies()` has no request context outside a
 * real Next.js render). Same reasoning `checkEligibility`
 * (scholarships/farah.ts) is already its own plain, non-"use server" module
 * rather than living inline in a Server Action.
 *
 * THE CLAIM STEP IS THE REAL CONCURRENCY GUARD. A conditional UPDATE
 * (`talent_verification_status IN ('unverified','rejected')`, service role,
 * before anything else runs) is the same one-statement check-and-act shape
 * CLAUDE.md requires for anything gating on a compared value — two
 * concurrent requests can only ever have one succeed at claiming `pending`;
 * the loser is refused immediately, before it ever reaches the LLM call or
 * spendCredits. See tests/talent-directory/verification-race.test.ts, which
 * is what actually proves this rather than assuming it from the shape.
 * spendCredits' own atomic RPC (0035) is the second, independent layer —
 * proven generically by spend-race.test.ts and inherited here "for free",
 * the same way referral_leaderboard inherited 0036's self-referral guard.
 */
export interface VerificationActionResult {
  status: "success" | "error";
  message: string;
  score?: number;
  passed?: boolean;
}

export async function runTalentVerification(userId: string): Promise<VerificationActionResult> {
  const serviceClient = createServiceRoleClient();
  const cost = CREDIT_COSTS.talentDirectoryVerification;

  const { data: claimed, error: claimError } = await serviceClient
    .from("profiles")
    .update({ talent_verification_status: "pending" })
    .eq("id", userId)
    .in("talent_verification_status", ["unverified", "rejected"])
    .select("id")
    .maybeSingle();

  if (claimError) return { status: "error", message: "Something went wrong on our end." };
  if (!claimed) {
    return {
      status: "error",
      message: "A verification attempt is already pending, or you're already verified.",
    };
  }

  const { data: verification, error: insertError } = await serviceClient
    .from("talent_verifications")
    .insert({ user_id: userId, status: "pending" })
    .select("id")
    .single();

  if (insertError || !verification) {
    // No talent_verifications row was ever created, so there's nothing for
    // release_talent_verification_claim's delete half to do — this reverts
    // just the profiles claim directly rather than routing through it with
    // a placeholder id.
    await serviceClient
      .from("profiles")
      .update({ talent_verification_status: "unverified" })
      .eq("id", userId)
      .eq("talent_verification_status", "pending");
    return { status: "error", message: "Something went wrong on our end." };
  }

  const { data: balanceRow } = await serviceClient
    .from("profiles")
    .select("credits_balance")
    .eq("id", userId)
    .single();

  if ((balanceRow?.credits_balance ?? 0) < cost) {
    await serviceClient.rpc("release_talent_verification_claim", {
      p_user_id: userId,
      p_verification_id: verification.id,
    });
    return {
      status: "error",
      message: `Not enough credits — this needs ${cost}, you have ${balanceRow?.credits_balance ?? 0}.`,
    };
  }

  const { data: resumeRow } = await serviceClient
    .from("resumes")
    .select("structured_content")
    .eq("user_id", userId)
    .eq("is_base", true)
    .maybeSingle();
  const resume = (resumeRow?.structured_content as StructuredResume | null) ?? EMPTY_RESUME;

  let grade;
  try {
    grade = await gradeResumeForVerification(resume);
  } catch {
    await serviceClient.rpc("release_talent_verification_claim", {
      p_user_id: userId,
      p_verification_id: verification.id,
    });
    return { status: "error", message: "Farah couldn't grade that just now — try again." };
  }

  /*
   * Wrapped the way scholarships/actions.ts already wraps its own spend: the
   * balance check above is informational, spendCredits' own atomic RPC is
   * what actually enforces it under a lock. A concurrent spend elsewhere
   * (another tab) between the pre-check and here is the one race this
   * cannot close — same accepted shape as every other credit-gated action in
   * this app.
   */
  try {
    await spendCredits(userId, cost, "talent_directory_verification", verification.id);
  } catch (err) {
    await serviceClient.rpc("release_talent_verification_claim", {
      p_user_id: userId,
      p_verification_id: verification.id,
    });
    if (err instanceof InsufficientCreditsError) {
      return { status: "error", message: "Your credit balance changed while that ran — top up and try again." };
    }
    throw err;
  }

  const { data: resolvedOk } = await serviceClient.rpc("resolve_talent_verification", {
    p_verification_id: verification.id,
    p_user_id: userId,
    p_verified: grade.passed,
    p_score: grade.score,
    p_feedback: grade.feedback,
  });

  if (!resolvedOk) {
    // Credits were already spent and the ledger is the source of truth here
    // — this is a genuinely unexpected state (the claim we hold should be
    // the only thing able to resolve this row) rather than a race to
    // silently swallow, so it's surfaced rather than pretended away.
    return {
      status: "error",
      message: "Your credits were charged but we couldn't record the result — contact support with this time.",
    };
  }

  return {
    status: "success",
    message: grade.passed
      ? "Verified — you're now eligible to list yourself in the directory."
      : "Not verified this time. See the feedback below and try again once you've updated your resume.",
    score: grade.score,
    passed: grade.passed,
  };
}

/**
 * The higher-cost, human-reviewed verification tier (0141/0142), alongside
 * runTalentVerification's AI-only path above. Same claim-then-spend shape,
 * deliberately: the claim step is the SAME conditional UPDATE on
 * `profiles.talent_verification_status` (unverified/rejected -> pending),
 * so a double-click can't queue two human-review requests any more than it
 * can trigger two AI grades. The one real difference is what happens after
 * the claim succeeds — there is no synchronous LLM call to wait on, so this
 * inserts a queued `talent_verifications` row (review_type='human',
 * status='pending', meaning "waiting for a reviewer to claim it" rather than
 * "an LLM call is in flight") and returns immediately once credits are
 * spent. See tests/talent-directory/human-review-race.test.ts for the same
 * race proof verification-race.test.ts already gives the AI path.
 */
export async function runTalentVerificationHumanReview(
  userId: string,
  targetRole?: string | null,
  targetIndustry?: string | null,
): Promise<VerificationActionResult> {
  const serviceClient = createServiceRoleClient();
  const cost = CREDIT_COSTS.talentDirectoryHumanReview;

  const { data: claimed, error: claimError } = await serviceClient
    .from("profiles")
    .update({ talent_verification_status: "pending" })
    .eq("id", userId)
    .in("talent_verification_status", ["unverified", "rejected"])
    .select("id")
    .maybeSingle();

  if (claimError) return { status: "error", message: "Something went wrong on our end." };
  if (!claimed) {
    return {
      status: "error",
      message: "A verification attempt is already pending, or you're already verified.",
    };
  }

  const { data: verification, error: insertError } = await serviceClient
    .from("talent_verifications")
    .insert({
      user_id: userId,
      status: "pending",
      review_type: "human",
      target_role: targetRole?.trim() || null,
      target_industry: targetIndustry?.trim() || null,
    })
    .select("id")
    .single();

  if (insertError || !verification) {
    // Same bailout runTalentVerification uses for the identical failure —
    // no talent_verifications row exists yet, so release_talent_verification_claim
    // (which deletes a 'pending' row) has nothing to do here either.
    await serviceClient
      .from("profiles")
      .update({ talent_verification_status: "unverified" })
      .eq("id", userId)
      .eq("talent_verification_status", "pending");
    return { status: "error", message: "Something went wrong on our end." };
  }

  try {
    await spendCredits(userId, cost, "talent_directory_human_review", verification.id);
  } catch (err) {
    await serviceClient.rpc("release_talent_verification_claim", {
      p_user_id: userId,
      p_verification_id: verification.id,
    });
    if (err instanceof InsufficientCreditsError) {
      return {
        status: "error",
        message: `Not enough credits — this needs ${cost}, you have ${err.available}.`,
      };
    }
    throw err;
  }

  return {
    status: "success",
    message: "Queued for human review — a mentor will pick this up and get back to you with a decision.",
  };
}
