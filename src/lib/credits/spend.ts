import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/lib/supabase/types";

type CreditReason = Database["public"]["Enums"]["credit_reason"];

export class InsufficientCreditsError extends Error {
  constructor(
    public required: number,
    public available: number,
  ) {
    super(`Needs ${required} credits, only ${available} available.`);
    this.name = "InsufficientCreditsError";
  }
}

/**
 * All credit_ledger writes go through the service-role client — RLS
 * deliberately has no insert policy for the authenticated role on that
 * table (see migration 0006_commerce), so a user can never grant themselves
 * credits by calling the API directly.
 */
export async function spendCredits(
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

  const currentBalance = profile?.credits_balance ?? 0;
  if (currentBalance < amount) {
    throw new InsufficientCreditsError(amount, currentBalance);
  }

  const balanceAfter = currentBalance - amount;
  const { error } = await supabase.from("credit_ledger").insert({
    user_id: userId,
    delta: -amount,
    reason,
    related_entity_id: relatedEntityId ?? null,
    balance_after: balanceAfter,
  });
  if (error) throw error;

  return balanceAfter;
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
