import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/lib/supabase/types";

type CreditReason = Database["public"]["Enums"]["credit_reason"];

export class InsufficientCreditsError extends Error {
  constructor(
    public required: number,
    public available: number,
    /** Set only when a pass-covered gate hit the daily fair-use cap and ALSO
     *  couldn't fall back to credits — see src/lib/passes/entitlement.ts's
     *  DAILY_CAP_MESSAGE for why this needs its own copy rather than the
     *  generic insufficient-credits message. */
    public capMessage?: string,
  ) {
    super(`Needs ${required} credits, only ${available} available.`);
    this.name = "InsufficientCreditsError";
  }
}

/**
 * Spends credits, atomically.
 *
 * All credit_ledger writes go through the service-role client — RLS
 * deliberately has no insert policy for the authenticated role on that table
 * (migration 0006_commerce), so a user can never grant themselves credits by
 * calling the API directly.
 *
 * THE CHECK AND THE DEDUCTION ARE ONE STATEMENT (migration 0035). The previous
 * implementation read the balance, compared it in JS, and inserted a ledger row
 * carrying a balance computed here — and the ledger trigger writes
 * `credits_balance = balance_after` as an ABSOLUTE overwrite, not a relative
 * decrement. Two concurrent spends therefore both read the same starting
 * balance, both passed the check, and both wrote the same `balance_after`: one
 * paid-for AI action, silently free, and a ledger sum that no longer matched
 * the cached balance.
 *
 * That race was reachable from all four callers — tailoring (which fires the
 * tailoring and cover-letter spends for one request), Auto-Apply (0034's lock
 * is released before this runs), Resume Builder's bullet rewrite, and the
 * scholarship eligibility/SOP actions. Fixing it here fixes it for all of them;
 * the signature is deliberately unchanged so no call site needed editing.
 */
export async function spendCredits(
  userId: string,
  amount: number,
  reason: CreditReason,
  relatedEntityId?: string,
): Promise<number> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase.rpc("spend_credits_atomic", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_related_entity_id: relatedEntityId ?? undefined,
  });
  if (error) throw new Error(`Couldn't spend credits: ${error.message}`);

  const result = data?.[0];
  if (!result) throw new Error("Couldn't spend credits: no response from the ledger.");

  // The loser of a race lands here, not on a silently-successful double spend.
  if (!result.ok) throw new InsufficientCreditsError(amount, result.balance_after);

  return result.balance_after;
}

/**
 * Grants credits, atomically (migration 0159/0160, send-229).
 *
 * THE READ AND THE WRITE USED TO BE SEPARATE STATEMENTS: read
 * profiles.credits_balance, add `amount` in JS, insert a credit_ledger row
 * carrying that computed balance_after — while apply_credit_ledger_entry's
 * trigger performs an ABSOLUTE overwrite of credits_balance from whatever
 * balance_after it's given, exactly the same trigger behaviour that made the
 * pre-0035 spendCredits bug possible. Two concurrent grants to the same user
 * both read the same starting balance and one grant's write clobbers the
 * other's — a lost grant, silently.
 *
 * grant_credits_atomic() does a single RELATIVE UPDATE
 * (credits_balance = credits_balance + p_amount) under the row's own lock, so
 * two concurrent grants serialize correctly instead of one overwriting the
 * other. Same function grant_referral_reward() (0160) now calls for the
 * referral-reward path — the actual real-world caller for this class of
 * grant, since credit_pack/pass fulfilment (0159) and referral payouts (0160)
 * both call it directly and no longer go through this wrapper. Kept and
 * fixed anyway so anything that starts calling grantCredits() in the future
 * doesn't reintroduce a bug this repo already reviewed once.
 */
export async function grantCredits(
  userId: string,
  amount: number,
  reason: CreditReason,
  relatedEntityId?: string,
): Promise<number> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase.rpc("grant_credits_atomic", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_related_entity_id: relatedEntityId ?? undefined,
  });
  if (error) throw new Error(`Couldn't grant credits: ${error.message}`);
  if (data == null) throw new Error("Couldn't grant credits: no response from the ledger.");

  return data;
}
