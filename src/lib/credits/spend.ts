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

export async function grantCredits(
  userId: string,
  amount: number,
  reason: CreditReason,
  relatedEntityId?: string,
): Promise<number> {
  const supabase = createServiceRoleClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("credits_balance")
    .eq("id", userId)
    .single();

  const balanceAfter = (profile?.credits_balance ?? 0) + amount;
  const { error } = await supabase.from("credit_ledger").insert({
    user_id: userId,
    delta: amount,
    reason,
    related_entity_id: relatedEntityId ?? null,
    balance_after: balanceAfter,
  });
  if (error) throw error;

  return balanceAfter;
}
