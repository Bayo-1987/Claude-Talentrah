import { grantCredits } from "@/lib/credits/spend";
import { logCreditGateEvent } from "@/lib/credits/gate-events";
import type { Database } from "@/lib/supabase/types";
import type { AllowanceResult, TailoringActionKind } from "@/lib/tailoring/gate";

/**
 * TAILORING-SAVE-REFUND-1. /api/tailoring commits each leg's allowance (a paid spend, the free-trial flag, a Pass-covered gate event) BEFORE it saves the result. This module is the route's record of what each
 * leg took, and the one place that gives it back when the save does not happen.
 *
 *  - paid leg:       grantCredits(user, credits, the SAME reason as the spend). grant_credits_atomic has no idempotency key, so a leg must be returned at most once: drain() empties the record, and a second
 *                    refund (the outer handler after a refunded failure) finds nothing to grant.
 *  - free-trial leg: the leg's own release() (the flag goes back to false), so a retry takes the free branch again.
 *  - Pass leg:       nothing to give back: its covered_by_pass event is written only AFTER the save (writePassCoverageEvent), so a failed save never consumed a fair-use slot.
 *
 * A refund that fails never throws and never changes what the person is told, except that the message must not say credits were returned: see describeRefund.
 */

type CreditReason = Database["public"]["Enums"]["credit_reason"];

export interface CommittedLeg {
  kind: TailoringActionKind;
  reason: CreditReason;
  mode: "paid" | "free_trial" | "pass";
  /** Credits the spend took (0 for a free-trial or Pass leg). */
  credits: number;
  creditsAvailableAtCheck: number;
  release?: () => Promise<void>;
}

export function legFromAllowance(kind: TailoringActionKind, allowance: AllowanceResult): CommittedLeg {
  return {
    kind,
    reason: kind === "tailoring" ? "tailoring_run" : "cover_letter_run",
    mode: allowance.isPassCovered ? "pass" : allowance.isFreeTrial ? "free_trial" : "paid",
    credits: allowance.creditsSpent,
    creditsAvailableAtCheck: allowance.creditsAvailableAtCheck,
    release: allowance.release,
  };
}

export class TailoringCommitLedger {
  private legs: CommittedLeg[] = [];

  record(leg: CommittedLeg): void {
    this.legs.push(leg);
  }

  /** The leg's result was delivered: it is no longer refundable. Returns it (once), or undefined if it is not recorded. */
  settle(kind: TailoringActionKind): CommittedLeg | undefined {
    const i = this.legs.findIndex((l) => l.kind === kind);
    return i === -1 ? undefined : this.legs.splice(i, 1)[0];
  }

  /** Every leg still recorded, each returned once: the list is empty afterwards. */
  drain(): CommittedLeg[] {
    const out = this.legs;
    this.legs = [];
    return out;
  }
}

export interface RefundOutcome {
  /** Credits actually granted back. */
  grantedCredits: number;
  /** Free-trial flags set back. */
  freeTrialsRestored: number;
  /** The ledger's balance after the last successful grant, or null if none succeeded. */
  lastBalance: number | null;
  failedGrants: { kind: TailoringActionKind; reason: CreditReason; credits: number; at: string }[];
  /** Kinds of legs this call dealt with (granted, released, or dropped as Pass legs). */
  kinds: TailoringActionKind[];
}

/** Gives back what the recorded legs took, once. Never throws. */
export async function refundTailoringCommits(userId: string, ledger: TailoringCommitLedger): Promise<RefundOutcome> {
  const outcome: RefundOutcome = { grantedCredits: 0, freeTrialsRestored: 0, lastBalance: null, failedGrants: [], kinds: [] };
  for (const leg of ledger.drain()) {
    outcome.kinds.push(leg.kind);
    if (leg.mode === "paid" && leg.credits > 0) {
      try {
        outcome.lastBalance = await grantCredits(userId, leg.credits, leg.reason);
        outcome.grantedCredits += leg.credits;
      } catch (err) {
        const at = new Date().toISOString();
        outcome.failedGrants.push({ kind: leg.kind, reason: leg.reason, credits: leg.credits, at });
        console.error(
          `[tailoring] REFUND FAILED user=${userId} reason=${leg.reason} credits=${leg.credits} at=${at}: the credits taken for a result that was not saved were not given back:`,
          err instanceof Error ? err.message : err,
        );
      }
    } else if (leg.mode === "free_trial") {
      try {
        await leg.release?.();
        outcome.freeTrialsRestored += 1;
      } catch (err) {
        console.error(`[tailoring] could not give back the free trial user=${userId} reason=${leg.reason}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  return outcome;
}

/** What the person is told. "returned" appears only when every paid grant went through; a failed grant names support and the time to quote. */
export function describeRefund(outcome: RefundOutcome, headline: string): string {
  if (outcome.failedGrants.length > 0) {
    return `${headline} We couldn't give your credits back automatically. Please contact support and quote this time: ${outcome.failedGrants[0].at}.`;
  }
  const parts: string[] = [];
  if (outcome.grantedCredits > 0) parts.push(`Your ${outcome.grantedCredits} credits were returned.`);
  if (outcome.freeTrialsRestored > 0) parts.push("Your free try was not used.");
  return [headline, ...parts].join(" ");
}

/** The covered_by_pass event is the Pass fair-use cap's count, so it is written only for a leg whose result was saved. Best-effort: a failure is logged and never turns a saved result into an error. */
export async function writePassCoverageEvent(userId: string, leg: CommittedLeg): Promise<void> {
  if (leg.mode !== "pass") return;
  try {
    await logCreditGateEvent({ userId, reason: leg.reason, creditsRequired: 0, creditsAvailable: leg.creditsAvailableAtCheck, outcome: "covered_by_pass" });
  } catch (err) {
    console.error(`[tailoring] could not record covered_by_pass user=${userId} reason=${leg.reason}:`, err instanceof Error ? err.message : err);
  }
}
