import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { spendCredits, InsufficientCreditsError } from "@/lib/credits/spend";
import { logCreditGateEvent } from "@/lib/credits/gate-events";
import { checkPassCoverage, DAILY_CAP_MESSAGE } from "@/lib/passes/entitlement";
import { captureEvent } from "@/lib/analytics/posthog";
import type { Database } from "@/lib/supabase/types";

type CreditReason = Database["public"]["Enums"]["credit_reason"];

export { InsufficientCreditsError };

type FreeTrialFlag = "free_trial_tailoring_used" | "free_trial_cover_letter_used";
const flagPatch = (flag: FreeTrialFlag, used: boolean) => (flag === "free_trial_tailoring_used" ? { free_trial_tailoring_used: used } : { free_trial_cover_letter_used: used });

/** Sets the trial flag only if it is still unset, and says whether THIS call did. A database error throws: when we cannot tell, the request must not be given a free run. */
async function claimFreeTrial(supabase: ReturnType<typeof createServiceRoleClient>, userId: string, flag: FreeTrialFlag): Promise<boolean> {
  const { data, error } = await supabase.from("profiles").update(flagPatch(flag, true)).eq("id", userId).eq(flag, false).select("id");
  if (error) throw new Error(`Could not claim the free trial: ${error.message}`);
  return (data ?? []).length === 1;
}

/** Gives a claimed trial back after a generation that did not complete. A failure to do so is logged, not thrown: the caller is already on its error path. */
async function releaseFreeTrial(supabase: ReturnType<typeof createServiceRoleClient>, userId: string, flag: FreeTrialFlag): Promise<void> {
  const { error } = await supabase.from("profiles").update(flagPatch(flag, false)).eq("id", userId).eq(flag, true);
  if (error) console.error(`[tailoring] could not give back the free trial (${flag}):`, error.message);
}

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
  /**
   * Present ONLY on a free-trial allowance, because only then did the check CLAIM something: the one-time trial flag was set (in one conditional UPDATE) before the model runs, so two requests
   * at once cannot both be the free run (QA TAILOR-RACE-1). Call it when the generation does not complete, so a failed run still does not burn the trial; a run that completes calls
   * commitTailoringAllowance instead and never releases. Absent for paid and Pass allowances: nothing was claimed.
   */
  release?: () => Promise<void>;
}

/**
 * Affordability check — call this BEFORE the Claude call so a user who can't afford it never triggers (and Talentrah never pays for) an LLM request. Pair with commitTailoringAllowance after the LLM
 * call actually succeeds, so a failed generation doesn't spend credits for nothing.
 *
 * It mutates in exactly one case: it CLAIMS the one-time free trial (a conditional `update ... where flag = false`), because a read followed by a later write cannot make a trial one-time. Five
 * simultaneous requests all read "unused" and all ran free (QA TAILOR-RACE-1). Whoever wins the claim gets `isFreeTrial` and a `release()` to call if the generation fails; everyone else is evaluated
 * as a paid request against the balance they read (credits, or InsufficientCreditsError). Credits are NOT touched here: the paid path is priced at the check and spent atomically at the commit.
 * A claim that is never released or committed (the process dies mid-generation) leaves the trial used; that is the accepted cost of a gate that cannot be raced.
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

  // The claim is ONE statement: it succeeds for exactly one of any number of simultaneous callers. A caller that reads "unused" but loses the claim falls through to the paid checks below.
  if (!profile[freeFlagField] && (await claimFreeTrial(supabase, userId, freeFlagField))) {
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
      release: () => releaseFreeTrial(supabase, userId, freeFlagField),
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

/**
 * What a commit left the account with, for the response the masthead updates from (issue #605).
 *
 * `balanceAfter` is the LEDGER's own `balance_after` for a spend — the value spend_credits_atomic computed
 * under its lock and spendCredits returns — never `creditsAvailableAtCheck - creditsSpent`: anything else
 * that touched the balance between the check and this commit (another tab, a top-up) would make a
 * recomputed number wrong. `null` when nothing was spent (free trial or Pass), so the client leaves the
 * masthead alone.
 */
export interface TailoringCommitResult {
  balanceAfter: number | null;
}

/** Actually marks the free trial used / deducts credits — call only after the LLM call succeeds. */
export async function commitTailoringAllowance(
  userId: string,
  kind: TailoringActionKind,
  allowance: AllowanceResult,
): Promise<TailoringCommitResult> {
  // Fired unconditionally, regardless of which branch below actually runs —
  // this function's own contract ("call only after the LLM call succeeds")
  // already guarantees a real run by the time it's invoked at all.
  // is_first_run is only ever true when the free trial itself is what
  // covered this run, not on every call.
  captureEvent(userId, "tailoring_run", { kind, is_first_run: allowance.isFreeTrial });

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
    return { balanceAfter: null };
  }

  const supabase = createServiceRoleClient();

  if (allowance.isFreeTrial) {
    const update =
      kind === "tailoring"
        ? { free_trial_tailoring_used: true }
        : { free_trial_cover_letter_used: true };
    await supabase.from("profiles").update(update).eq("id", userId);
    return { balanceAfter: null };
  }

  const balanceAfter = await spendCredits(
    userId,
    allowance.creditsSpent,
    kind === "tailoring" ? "tailoring_run" : "cover_letter_run",
  );
  return { balanceAfter };
}
