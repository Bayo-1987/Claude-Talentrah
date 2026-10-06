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
 * THE CLAIM STEP IS THE REAL CONCURRENCY GUARD, AND THE ATTEMPT LIMIT. claim_ai_talent_verification is one database call: it locks the person's profile row, refuses unless the profile is
 * unverified or rejected, refuses once the person has two AI reviews resolved in the last 30 days (a flagged one counts, a released one does not), and otherwise sets the profile to pending and
 * inserts the pending row. It is the same one-statement check-and-act shape CLAUDE.md requires for anything gating on a counted or compared value: two concurrent requests can only ever have one
 * succeed, and the loser is refused immediately, before it ever reaches the LLM call or spendCredits. See tests/talent-directory/verification-race.test.ts and
 * tests/talent-directory/ai-verification-attempt-limit.test.ts, which prove this rather than assuming it from the shape.
 * spendCredits' own atomic RPC (0035) is the second, independent layer — proven generically by spend-race.test.ts and inherited here "for free", the same way referral_leaderboard
 * inherited 0036's self-referral guard.
 */
export interface VerificationActionResult {
  status: "success" | "error";
  message: string;
  score?: number;
  passed?: boolean;
}

/** What the person is told when they have used both AI resume reviews in the last 30 days. States the rule and the date the next one opens, and points to a review by a Talentrah mentor (the wording of the Resume reviewed by … badge), which has no such limit. */
export function attemptLimitMessage(nextAllowedAt: string | null | undefined): string {
  const when = nextAllowedAt ? new Date(nextAllowedAt) : null;
  const date = when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null;
  return `You've used both of your resume reviews by Farah (AI) in the past 30 days.${date ? ` The next one opens on ${date}.` : ""} If you'd rather not wait, you can ask a Talentrah mentor to review your resume.`;
}

export async function runTalentVerification(userId: string): Promise<VerificationActionResult> {
  const serviceClient = createServiceRoleClient();
  const cost = CREDIT_COSTS.talentDirectoryVerification;

  // One database call claims the profile, enforces the attempt limit and inserts the pending row: a limit read here and acted on afterwards would let two concurrent third attempts both through.
  const { data: claimRows, error: claimError } = await serviceClient.rpc("claim_ai_talent_verification", { p_user_id: userId });
  const claim = claimRows?.[0];

  if (claimError || !claim) return { status: "error", message: "Something went wrong on our end." };
  if (!claim.ok || !claim.verification_id) {
    if (claim.reason === "limit_reached") return { status: "error", message: attemptLimitMessage(claim.next_allowed_at) };
    if (claim.reason === "not_claimable") {
      return {
        status: "error",
        message: "A resume review is already pending, or your resume has already been reviewed.",
      };
    }
    return { status: "error", message: "Something went wrong on our end." };
  }
  const verification = { id: claim.verification_id };

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
   * A FLAGGED grade (the resume tried to instruct the grader, see injection-flags.ts) was never graded, so it is not charged. It is still RECORDED: the row is resolved below as rejected with
   * its feedback (not released, which deletes it), so the attempt counts toward any limit on a person's verification rows. A flagged grade can never be a pass.
   */
  if (grade.flagged) grade = { ...grade, passed: false }; // a flagged grade can never be a pass, whatever the object says: enforced once, here, so every use below reads grade.passed
  const charged = !grade.flagged;

  /*
   * Wrapped the way scholarships/actions.ts already wraps its own spend: the
   * balance check above is informational, spendCredits' own atomic RPC is
   * what actually enforces it under a lock. A concurrent spend elsewhere
   * (another tab) between the pre-check and here is the one race this
   * cannot close — same accepted shape as every other credit-gated action in
   * this app.
   */
  if (charged) {
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
  }

  // A flagged attempt is resolved by its own function, which records why it was refused (flag_source); every other result goes through the one resolver as before.
  const { data: resolvedOk } = grade.flagged
    ? await serviceClient.rpc("resolve_flagged_talent_verification", {
        p_verification_id: verification.id,
        p_user_id: userId,
        p_feedback: grade.feedback,
        p_flag_source: grade.flagSource ?? "pattern",
      })
    : await serviceClient.rpc("resolve_talent_verification", {
        p_verification_id: verification.id,
        p_user_id: userId,
        p_verified: grade.passed,
        p_score: grade.score,
        p_feedback: grade.feedback,
      });

  if (!resolvedOk) {
    if (!charged) return { status: "error", message: "Something went wrong on our end. You haven't been charged." };
    // Credits were already spent and the ledger is the source of truth here
    // — this is a genuinely unexpected state (the claim we hold should be
    // the only thing able to resolve this row) rather than a race to
    // silently swallow, so it's surfaced rather than pretended away.
    return {
      status: "error",
      message: "Your credits were charged but we couldn't record the result — contact support with this time.",
    };
  }

  if (!charged) {
    return {
      status: "success",
      message:
        "This review couldn't be completed: your resume contains text that reads like instructions to the grader. You haven't been charged. Remove that text and try again, or ask for “Resume reviewed by a Talentrah mentor”, where a person reads it.",
      score: grade.score,
      passed: false,
    };
  }

  return {
    status: "success",
    message: grade.passed
      ? "Resume reviewed — you're now eligible to list yourself in the directory."
      : "This review found things to fix. See the feedback below and try again once you've updated your resume.",
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
      message: "A resume review is already pending, or your resume has already been reviewed.",
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
