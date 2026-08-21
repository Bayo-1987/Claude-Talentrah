import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { spendCredits, InsufficientCreditsError } from "@/lib/credits/spend";

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

  if (!profile[freeFlagField]) {
    return { isFreeTrial: true, creditsSpent: 0 };
  }

  const cost = kind === "tailoring" ? CREDIT_COSTS.tailoringRun : CREDIT_COSTS.coverLetterRun;
  if (profile.credits_balance < cost) {
    throw new InsufficientCreditsError(cost, profile.credits_balance);
  }
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
