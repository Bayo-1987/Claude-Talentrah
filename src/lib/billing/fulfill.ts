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
 *
 * `expectedUserId` scopes the call to one user and MUST be passed by any
 * caller that has a session. It exists because this function runs on the
 * service-role client, which bypasses RLS: the reference alone decides which
 * row is acted on, and on the callback path that reference arrives as a URL
 * query parameter — i.e. client-supplied input.
 *
 * The webhook deliberately passes nothing. It has no session to scope to,
 * and it is already authenticated by HMAC signature over the raw body.
 *
 * A mismatch returns `not_found` rather than a distinct error, so this can't
 * be used to probe whether a given reference exists.
 */
export async function fulfillPayment(
  reference: string,
  expectedUserId?: string,
): Promise<FulfillResult> {
  const supabase = createServiceRoleClient();

  const { data: transaction } = await supabase
    .from("payment_transactions")
    .select("*")
    .eq("paystack_reference", reference)
    .single();

  if (!transaction) return { status: "not_found" };
  // Checked before anything else touches the row — in particular before the
  // Paystack verify below, whose failure path writes status "failed"
  // permanently. Without this, a signed-in user holding someone else's
  // reference could burn that transaction into a terminal state, and the
  // owner's later real payment would then land on a row that is no longer
  // "pending" and grant them nothing.
  if (expectedUserId && transaction.user_id !== expectedUserId) {
    return { status: "not_found" };
  }
  if (transaction.status !== "pending") return { status: "already_processed" };

  const verified = await verifyTransaction(reference);
  if (verified.status !== "success") {
    await supabase
      .from("payment_transactions")
      .update({ status: "failed" })
      .eq("id", transaction.id);
    return { status: "failed" };
  }

  // Ground truth for the rail actually used, straight from Paystack's
  // verify response — never inferred from what checkout offered. A card
  // authorization is only ever eligible for silent recharge if Paystack
  // itself marked it reusable; if it didn't, treat this like any other
  // non-card rail rather than promising a renewal we can't perform.
  const channel = verified.channel;
  const authorization = verified.authorization ?? null;
  const isReusableCard = channel === "card" && !!authorization?.reusable;
  const authorizationCode = isReusableCard ? authorization!.authorization_code : null;

  /*
   * `product_id` became nullable in 0050 so a wallet top-up — which has no
   * product row — could be recorded without inventing one. A CHECK constraint
   * keeps it REQUIRED for credit_pack and pass, so these two branches cannot
   * see a null in practice; the guards are here because the type is now
   * honestly nullable and skipping the grant is the right behaviour if the
   * constraint is ever loosened. Silently doing nothing beats crashing a
   * webhook, which Paystack would then retry forever.
   */
  if (transaction.product_type === "credit_pack" && transaction.product_id) {
    const { data: pack } = await supabase
      .from("credit_packs")
      .select("credits")
      .eq("id", transaction.product_id)
      .single();
    if (pack) {
      await grantCredits(transaction.user_id, pack.credits, "purchase", transaction.id);
    }
  } else if (transaction.product_type === "pass" && transaction.product_id) {
    const { data: pass } = await supabase
      .from("passes")
      .select("duration_days")
      .eq("id", transaction.product_id)
      .single();
    if (pass) {
      const expiresAt = new Date(Date.now() + pass.duration_days * 24 * 60 * 60 * 1000);
      const autoRenew = isReusableCard;

      await supabase.from("user_passes").insert({
        user_id: transaction.user_id,
        pass_id: transaction.product_id,
        expires_at: expiresAt.toISOString(),
        // Per build-prompt §6.9: card auto-renews, every other rail
        // (bank/bank_transfer/ussd on Paystack for NGN — see NGN_CHANNELS)
        // is prepaid/non-renewing. This is a binary bucket, not a literal
        // echo of Paystack's channel string.
        payment_method: channel === "card" ? "card" : "mobile_money",
        auto_renew: autoRenew,
        auto_renew_status: autoRenew ? "active" : null,
        next_renewal_date: autoRenew ? toDateOnly(expiresAt) : null,
        authorization_code: authorizationCode,
        payment_transaction_id: transaction.id,
        status: "active",
      });
    }
  } else if (transaction.product_type === "ad_wallet_topup") {
    /*
     * The organisation's ad wallet.
     *
     * IT PASSES THE PAYSTACK REFERENCE AS THE IDEMPOTENCY KEY, and that is not
     * decoration. `credit_ad_wallet` dedupes on
     * `ad_wallet_ledger_topup_reference_idx`, which is UNIQUE on
     * `paystack_reference` WHERE paystack_reference IS NOT NULL — a PARTIAL
     * index. Pass null, or pass a freshly minted id instead of the real
     * reference, and the index stops applying: nothing collides, and a second
     * delivery credits the wallet again. 0050 makes `payment_transactions`
     * refuse a top-up row with a null reference precisely so this argument
     * cannot be null by the time it reaches here.
     *
     * WHY THAT CARRIES REAL WEIGHT. The `status !== "pending"` guard at the top
     * of this function is a read-then-act check, and the comment below records
     * that the webhook/callback double-grant race is open and out of scope.
     * It is not theoretical: the Paystack webhook and the top-up callback page
     * both call this function for the same reference, and a user landing on
     * the callback while the webhook is in flight is the ordinary case. For
     * credit packs and passes nothing closes that race. For a wallet top-up
     * the unique index does — it is the only defence, so it is spelled out
     * rather than assumed.
     */
    if (transaction.organization_id && transaction.paystack_reference) {
      await supabase.rpc("credit_ad_wallet", {
        p_organization_id: transaction.organization_id,
        p_amount_ngn: transaction.amount,
        p_reason: "topup",
        p_paystack_reference: transaction.paystack_reference,
        p_actor_user_id: transaction.user_id,
      });
    }
  }

  // Marked success only after the grant above has run. Ordering matches the
  // original code deliberately: flipping status first would close the
  // webhook/callback double-grant race but replace it with a worse one — a
  // crash in between would leave the user charged, unfulfilled, and unable to
  // retry (the "pending" guard above would short-circuit). Making this
  // genuinely atomic is out of scope here.
  await supabase
    .from("payment_transactions")
    .update({
      status: "success",
      channel,
      authorization_code: authorizationCode,
    })
    .eq("id", transaction.id);

  return { status: "success" };
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
