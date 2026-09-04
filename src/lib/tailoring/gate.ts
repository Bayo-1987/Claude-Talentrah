import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { spendCredits, InsufficientCreditsError } from "@/lib/credits/spend";
import { logCreditGateEvent } from "@/lib/credits/gate-events";
import { checkPassCoverage, DAILY_CAP_MESSAGE } from "@/lib/passes/entitlement";
import type { Database } from "@/lib/supabase/types";

type CreditReason = Database["public"]["Enums"]["credit_reason"];

export { InsufficientCreditsError };

export type TailoringActionKind = "tailoring" | "cover_letter";

export interface AllowanceResult {
  isFreeTrial: boolean;
  isPassCovered: boolean;
  creditsSpent: number;
  /**
   * The balance as of the check, carried through to commitTailoringAllowance
   * purely so it can write the covered_by_pass gate-event log AFTER the LLM
   * call succeeds — see that function for why the log itself has to wait.
   */
  creditsAvailableAtCheck: number;
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

  /*
   * Checked FIRST, before the free-trial flag — an active pass covers this
   * run at zero cost, and the free trial must survive untouched for the day
   * the pass expires. Checking pass coverage after the free-trial branch
   * would still get the credit math right, but a pass holder's very first
   * tailoring run would silently burn their one-time free trial for a run
   * that cost them nothing, which is exactly the flag misuse Part A rules
   * out.
   */
  const coverage = await checkPassCoverage(userId);
  if (coverage.covered) {
    /*
     * NOT logged here. This event counts against the Pass's daily fair-use
     * cap (PASS_DAILY_ACTION_CAP, credit_gate_events with outcome =
     * covered_by_pass) — logging it before the LLM call below even runs
     * would burn a cap slot on a run that fails outright. Confirmed live: a
     * 502 from the provider still consumed one. commitTailoringAllowance
     * writes it instead, and is only ever called after the LLM call has
     * already succeeded — exactly the same ordering that already protects
     * credits and the free-trial flag from a failed generation, just
     * applied to the cap too. Every OTHER outcome below stays logged
     * immediately, because none of them count against a capped resource.
     */
    return {
      isFreeTrial: false,
      isPassCovered: true,
      creditsSpent: 0,
      creditsAvailableAtCheck: profile.credits_balance,
    };
  }

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
    return {
      isFreeTrial: true,
      isPassCovered: false,
      creditsSpent: 0,
      creditsAvailableAtCheck: profile.credits_balance,
    };
  }

  if (profile.credits_balance < cost) {
    await logCreditGateEvent({
      userId,
      reason,
      creditsRequired: cost,
      creditsAvailable: profile.credits_balance,
      outcome: "blocked_insufficient_credits",
    });
    throw new InsufficientCreditsError(
      cost,
      profile.credits_balance,
      coverage.reason === "daily_cap_reached" ? DAILY_CAP_MESSAGE : undefined,
    );
  }

  await logCreditGateEvent({
    userId,
    reason,
    creditsRequired: cost,
    creditsAvailable: profile.credits_balance,
    outcome: "proceeded",
  });
  return {
    isFreeTrial: false,
    isPassCovered: false,
    creditsSpent: cost,
    creditsAvailableAtCheck: profile.credits_balance,
  };
}

/** Actually marks the free trial used / deducts credits — call only after the LLM call succeeds. */
export async function commitTailoringAllowance(
  userId: string,
  kind: TailoringActionKind,
  allowance: AllowanceResult,
): Promise<void> {
  // Pass-covered: no credit spend, and — the specific thing Part A rules
  // out — no free-trial flag flip either, since isFreeTrial is false for a
  // pass-covered run and this branch is checked first. The gate event IS
  // written here though (see checkTailoringAllowance's header on why it
  // isn't written there): this function only runs after the LLM call has
  // already succeeded, so a failed run never reaches this line and never
  // consumes a fair-use cap slot for work that produced nothing.
  if (allowance.isPassCovered) {
    const reason: CreditReason = kind === "tailoring" ? "tailoring_run" : "cover_letter_run";
    await logCreditGateEvent({
      userId,
      reason,
      creditsRequired: 0,
      creditsAvailable: allowance.creditsAvailableAtCheck,
      outcome: "covered_by_pass",
    });
    return;
  }

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
