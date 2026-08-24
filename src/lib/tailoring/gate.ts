import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { spendCredits, InsufficientCreditsError } from "@/lib/credits/spend";
import { logCreditGateEvent } from "@/lib/credits/gate-events";
import type { Database } from "@/lib/supabase/types";

type CreditReason = Database["public"]["Enums"]["credit_reason"];

export { InsufficientCreditsError };

export type TailoringActionKind = "tailoring" | "cover_letter";

export interface AllowanceResult {
  isFreeTrial: boolean;
  creditsSpent: number;
}

/**
 * Read-only affordability check — call this BEFORE the Claude call so a
 * user who can't afford it never triggers (and Talentrah never pays for) an
 * LLM request. Does not mutate anything; pair with commitTailoringAllowance
 * after the LLM call actually succeeds, so a failed generation doesn't burn
 * the user's one-time free trial or spend credits for nothing.
 */
export async function checkTailoringAllowance(
  userId: string,
  kind: TailoringActionKind,
): Promise<AllowanceResult> {
  const supabase = createServiceRoleClient();
  const freeFlagField =
    kind === "tailoring" ? "free_trial_tailoring_used" : "free_trial_cover_letter_used";

  const { data: profile } = await supabase
    .from("profiles")
    .select("free_trial_tailoring_used, free_trial_cover_letter_used, credits_balance")
    .eq("id", userId)
    .single();

  if (!profile) throw new Error("Profile not found.");

  const reason: CreditReason = kind === "tailoring" ? "tailoring_run" : "cover_letter_run";
  const cost = kind === "tailoring" ? CREDIT_COSTS.tailoringRun : CREDIT_COSTS.coverLetterRun;

  if (!profile[freeFlagField]) {
    // A free-trial run is still a gate evaluation, and it's the one that
    // most often *precedes* the first real paywall — logging it with
    // creditsRequired 0 keeps the funnel continuous rather than starting
    // mid-story at the first block.
    await logCreditGateEvent({
      userId,
      reason,
      creditsRequired: 0,
      creditsAvailable: profile.credits_balance,
      outcome: "proceeded",
    });
    return { isFreeTrial: true, creditsSpent: 0 };
  }

  if (profile.credits_balance < cost) {
    await logCreditGateEvent({
      userId,
      reason,
      creditsRequired: cost,
      creditsAvailable: profile.credits_balance,
      outcome: "blocked_insufficient_credits",
    });
    throw new InsufficientCreditsError(cost, profile.credits_balance);
  }

  await logCreditGateEvent({
    userId,
    reason,
    creditsRequired: cost,
    creditsAvailable: profile.credits_balance,
    outcome: "proceeded",
  });
  return { isFreeTrial: false, creditsSpent: cost };
}

/** Actually marks the free trial used / deducts credits — call only after the LLM call succeeds. */
export async function commitTailoringAllowance(
  userId: string,
  kind: TailoringActionKind,
  allowance: AllowanceResult,
): Promise<void> {
  const supabase = createServiceRoleClient();

  if (allowance.isFreeTrial) {
    const update =
      kind === "tailoring"
        ? { free_trial_tailoring_used: true }
        : { free_trial_cover_letter_used: true };
    await supabase.from("profiles").update(update).eq("id", userId);
    return;
  }

  await spendCredits(
    userId,
    allowance.creditsSpent,
    kind === "tailoring" ? "tailoring_run" : "cover_letter_run",
  );
}
