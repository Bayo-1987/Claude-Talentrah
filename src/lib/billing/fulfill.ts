import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { verifyTransaction } from "@/lib/paystack/client";
import { grantCredits } from "@/lib/credits/spend";

export interface FulfillResult {
  status: "success" | "already_processed" | "failed" | "not_found";
}

/**
 * Idempotent — called from both the Paystack webhook (production) and the
 * checkout callback page (so local dev, where Paystack can't reach a
 * localhost webhook, still works). Whichever runs first wins; the other is
 * a no-op once payment_transactions.status is no longer "pending".
 */
export async function fulfillPayment(reference: string): Promise<FulfillResult> {
  const supabase = createServiceRoleClient();

  const { data: transaction } = await supabase
    .from("payment_transactions")
    .select("*")
    .eq("paystack_reference", reference)
    .single();

  if (!transaction) return { status: "not_found" };
  if (transaction.status !== "pending") return { status: "already_processed" };

  const verified = await verifyTransaction(reference);
  if (verified.status !== "success") {
    await supabase
      .from("payment_transactions")
      .update({ status: "failed" })
      .eq("id", transaction.id);
    return { status: "failed" };
  }

  if (transaction.product_type === "credit_pack") {
    const { data: pack } = await supabase
      .from("credit_packs")
      .select("credits")
      .eq("id", transaction.product_id)
      .single();
    if (pack) {
      await grantCredits(transaction.user_id, pack.credits, "purchase", transaction.id);
    }
  } else if (transaction.product_type === "pass") {
    const { data: pass } = await supabase
      .from("passes")
      .select("duration_days")
      .eq("id", transaction.product_id)
      .single();
    if (pass) {
      const expiresAt = new Date(Date.now() + pass.duration_days * 24 * 60 * 60 * 1000);
      await supabase.from("user_passes").insert({
        user_id: transaction.user_id,
        pass_id: transaction.product_id,
        expires_at: expiresAt.toISOString(),
        payment_method: "card",
        auto_renew: true,
        status: "active",
      });
    }
  }

  await supabase
    .from("payment_transactions")
    .update({ status: "success" })
    .eq("id", transaction.id);

  return { status: "success" };
}
