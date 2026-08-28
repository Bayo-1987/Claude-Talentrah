import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import { visibleName } from "@/lib/profile/name";
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
  /*
   * What to name in the receipt. Set only by the two branches that email —
   * left null for ad_wallet_topup, which is the employer surface and out of
   * scope, so "did we email?" and "is this a seeker purchase?" stay one
   * question rather than two that can disagree.
   */
  let purchased: string | null = null;

  if (transaction.product_type === "credit_pack" && transaction.product_id) {
    const { data: pack } = await supabase
      .from("credit_packs")
      .select("credits")
      .eq("id", transaction.product_id)
      .single();
    if (pack) {
      await grantCredits(transaction.user_id, pack.credits, "purchase", transaction.id);
      purchased = `${pack.credits.toLocaleString()} credits`;
    }
  } else if (transaction.product_type === "pass" && transaction.product_id) {
    const { data: pass } = await supabase
      .from("passes")
      .select("duration_days, name")
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
      purchased = pass.name;
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

  /*
   * AFTER the status flip, not before. A receipt that arrives while the row is
   * still `pending` is a promise the database has not made yet — and if the
   * update below it failed, the person would hold an email for a purchase the
   * system does not believe in.
   *
   * Failure here is swallowed on purpose: the money moved and the grant landed,
   * so a dead Resend key must not turn a completed purchase into a thrown
   * error that Paystack then retries. Logged, because a receipt that silently
   * stopped sending is exactly the kind of thing nobody notices for months.
   */
  if (purchased) {
    try {
      await sendPurchaseReceipt(supabase, {
        userId: transaction.user_id,
        productName: purchased,
        /*
         * `amount` is NAIRA, not kobo. The kobo conversion lives at the
         * Paystack boundary (`Math.round(amountNgn * 100)` in the client) and
         * nowhere else, so this column is what the customer was charged in the
         * unit the receipt prints. Worth stating: getting it wrong here means
         * a receipt off by a factor of 100, in the direction that looks like
         * an overcharge.
         */
        amountNgn: transaction.amount,
        reference,
      });
    } catch (err) {
      console.error("[fulfill] purchase receipt failed to send", err);
    }
  }

  return { status: "success" };
}

/**
 * Receipt for a credit pack or a Pass.
 *
 * SAME SHAPE AS renewals.ts's sendReminderEmail, deliberately: same
 * getResendClient(), same sender, same visibleName() greeting, and the same
 * silent no-op when RESEND_API_KEY is unconfigured. A receipt is worth less
 * than the purchase — failing the fulfilment because an email could not be
 * sent would turn a completed payment into a broken one.
 *
 * NO NEW IDEMPOTENCY GUARD. The `status !== "pending"` check at the top of
 * fulfillPayment already makes this whole path run exactly once per
 * reference: the webhook and the browser callback both call it, and the second
 * caller returns `already_processed` before reaching here. Adding a second
 * guard would imply the first is unreliable, which would be the more alarming
 * claim.
 *
 * NOT FOR ad_wallet_topup. That is the employer's ad wallet, billed to an
 * organisation rather than a person — a different recipient, a different
 * voice, and out of scope here. It is excluded by the caller rather than by a
 * check inside, so the omission is visible at the call site.
 *
 * THE PROFILE IS FETCHED WITH A PLAIN SERVICE-ROLE QUERY, not a join. The
 * embedded-resource syntax needs an FK constraint NAME
 * (`profiles!user_passes_user_id_fkey(...)` next door), and guessing one that
 * does not exist fails at runtime with a message about schema cache rather
 * than anything obvious. Two queries is cheaper than being wrong about it.
 */
async function sendPurchaseReceipt(
  supabase: ReturnType<typeof createServiceRoleClient>,
  args: { userId: string; productName: string; amountNgn: number; reference: string },
) {
  const resend = getResendClient();
  if (!resend) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, first_name")
    .eq("id", args.userId)
    .maybeSingle();
  if (!profile?.email) return;

  const greeting = visibleName(profile.first_name);
  await resend.emails.send({
    from: "Talentrah <billing@talentrah.com>",
    to: profile.email,
    subject: `Your Talentrah purchase — ${args.productName}`,
    text:
      `Hi${greeting ? ` ${greeting}` : ""},\n\n` +
      `Thanks — your payment went through.\n\n` +
      `What you bought: ${args.productName}\n` +
      `Amount: ₦${args.amountNgn.toLocaleString()}\n` +
      `Receipt number: ${args.reference}\n\n` +
      `Quote the receipt number if you ever need to ask us about this payment. ` +
      `You can see all your purchases on your Billing page.\n\n— Talentrah`,
  });
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
