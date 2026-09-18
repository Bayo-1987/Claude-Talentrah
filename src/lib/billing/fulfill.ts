import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import { visibleName } from "@/lib/profile/name";
import { verifyTransaction } from "@/lib/paystack/client";
import { captureEvent } from "@/lib/analytics/posthog";
import { absoluteUrl } from "@/lib/seo/site";
import { emailParagraph, escEmail, renderBrandedEmail } from "@/lib/email/layout";

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

  /*
   * Ground truth, checked, not assumed. Every other decision in this
   * function trusts `verified.status`, but status alone is not the whole
   * claim Paystack is making — it also says WHAT was paid, and that has
   * never been checked against what this transaction row actually expects.
   * `transaction.amount` is server-derived (initiatePurchaseAction looks it
   * up from credit_packs/passes by id, never from client input), so this
   * isn't guarding against a client tampering with a number it never
   * controlled — it's the backstop against any future bug, race, or
   * reference-confusion that leaves a `payment_transactions` row
   * inconsistent with what Paystack actually confirmed, and it is Paystack's
   * own documented integration guidance. `transaction.amount` is whole
   * Naira (an integer column); Paystack's `amount` is kobo — the `* 100`
   * mirrors the exact conversion `initializeTransaction` does at the other
   * end of this same transaction's life.
   */
  const expectedKobo = Math.round(transaction.amount * 100);
  if (verified.amount !== expectedKobo || verified.currency !== transaction.currency) {
    console.error(
      `[fulfill] amount/currency mismatch for ${reference}: expected ${expectedKobo} kobo ` +
        `${transaction.currency}, Paystack confirmed ${verified.amount} ${verified.currency}. Not fulfilling.`,
    );
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
   * What to name in the receipt. Set only by the branches that email — left
   * null for ad_wallet_topup, which is the employer surface and out of
   * scope, so "did we email?" and "is this a seeker purchase?" stay one
   * question rather than two that can disagree.
   */
  let purchased: string | null = null;

  if (transaction.product_type === "credit_pack" || transaction.product_type === "pass") {
    /*
     * ATOMIC — migration 0159 (send-228). The status check and the grant used
     * to be separate statements: read `status`, check it in JS, and only
     * much later write the credit_ledger row / user_passes row and flip
     * `status`. Two near-simultaneous webhook deliveries for the same
     * reference (Paystack retries a delivery it didn't get a clean 2xx for —
     * 0043 already assumes this happens) both read "pending", both passed,
     * and both granted: a customer who paid once got a credit pack or Pass
     * twice.
     *
     * fulfill_credit_pack_or_pass() does the conditional
     * `UPDATE ... WHERE status = 'pending'` claim AND the grant inside one
     * function call/transaction, so only the caller that actually claimed
     * the row ever grants anything — see the migration's own header for why
     * this is also safer on a crash mid-grant than the old grant-then-flip
     * ordering was.
     *
     * `product_id` can be null in principle (0050 made the column nullable
     * for ad_wallet_topup's sake; a CHECK constraint keeps it required for
     * credit_pack/pass in practice) — the RPC's own claim only matches rows
     * whose product_type is credit_pack/pass, and a null product_id simply
     * fails both internal lookups and returns `claimed: true` with nothing
     * granted, the same silent-no-op behaviour the old per-branch guards had.
     */
    const { data, error } = await supabase.rpc("fulfill_credit_pack_or_pass", {
      p_transaction_id: transaction.id,
      p_channel: channel,
      p_authorization_code: authorizationCode ?? undefined,
    });
    if (error) throw new Error(`fulfill_credit_pack_or_pass failed: ${error.message}`);

    const result = data?.[0];
    if (!result?.claimed) {
      // Lost the race (or the top-level check above was already stale by the
      // time we got here) — another call already fulfilled this reference.
      return { status: "already_processed" };
    }

    if (result.product_type === "credit_pack" && result.credits_granted != null) {
      purchased = `${result.credits_granted.toLocaleString()} credits`;
    } else if (result.product_type === "pass" && result.pass_name) {
      purchased = result.pass_name;
    }

    // The RPC already flipped payment_transactions to "success" with the
    // right channel/authorization_code, inside the same transaction as the
    // grant — the unconditional flip below this if/else chain would just be
    // a redundant, harmless rewrite of the same values, but returning here
    // directly avoids relying on that and keeps this branch's own atomicity
    // story self-contained. Same receipt-sending shape as the tail below.
    if (purchased) {
      try {
        await sendPurchaseReceipt(supabase, {
          userId: transaction.user_id,
          productName: purchased,
          amountNgn: transaction.amount,
          reference,
        });
      } catch (err) {
        console.error("[fulfill] purchase receipt failed to send", err);
      }
    }
    // Only this branch's own success return — not the shared return at the
    // end of this function, which talent_directory_subscription,
    // ad_wallet_topup and mentor_session also reach. Not the
    // "already_processed" branch above either: the webhook/callback race
    // this function's own header documents would otherwise double-count
    // the same purchase.
    captureEvent(transaction.user_id, "credit_purchase_completed", {
      amount_ngn: transaction.amount,
      product_type: result.product_type,
    });
    return { status: "success" };
  } else if (transaction.product_type === "talent_directory_subscription" && transaction.product_id) {
    /*
     * The org's Talent Directory subscription — a fixed-price, fixed-date
     * Pass-style charge (0135's own header explains why), so this branch is
     * the direct mirror of the `pass` branch just above it: reusable-card
     * checkout auto-renews, every other rail is prepaid/non-renewing.
     *
     * THE ROW ALREADY EXISTS, IN `pending_payment`. Unlike credit_pack/pass
     * (which grant by INSERTing a new row here) or mentor_session (created
     * atomically at booking time by its own SQL function), this is the ONE
     * product type where the client-initiated Server Action
     * (purchaseTalentDirectorySubscriptionAction) creates the row itself,
     * before payment — because the partial unique index enforcing "one
     * active subscription per org" needs a real row to apply the constraint
     * to, and that check has to happen before Paystack is ever contacted,
     * not after. This branch's only job is the state transition
     * pending_payment -> active; it never inserts.
     *
     * `.eq("status", "pending_payment")` on the UPDATE is this function's
     * own belt-and-braces idempotency layer, same reasoning 0132's own
     * mentor_session branch uses it for: the top-level `status !== "pending"`
     * guard on `transaction` already stops a webhook redelivery from
     * reaching this branch twice, but this makes the SUBSCRIPTION-side state
     * change itself a no-op if it were ever somehow reached twice.
     */
    const { data: subscription } = await supabase
      .from("talent_directory_subscriptions")
      .select("plan_id, expires_at, talent_directory_plans(name)")
      .eq("id", transaction.product_id)
      .single();

    if (subscription) {
      const autoRenew = isReusableCard;
      const { data: updated } = await supabase
        .from("talent_directory_subscriptions")
        .update({
          status: "active",
          auto_renew_status: autoRenew ? "active" : null,
          next_renewal_date: autoRenew ? toDateOnly(new Date(subscription.expires_at)) : null,
          authorization_code: authorizationCode,
          payment_transaction_id: transaction.id,
        })
        .eq("id", transaction.product_id)
        .eq("status", "pending_payment")
        .select("id")
        .maybeSingle();

      if (updated) {
        purchased = subscription.talent_directory_plans?.name ?? "Talent Directory subscription";
      }
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
  } else if (transaction.product_type === "mentor_session" && transaction.product_id) {
    /*
     * The session row already exists — book_mentor_session (0133) created it
     * in `pending_payment`, atomically with the slot lock, at booking time,
     * BEFORE payment was even initiated. Fulfilment's only job for a mentor
     * session is to move it to `awaiting_confirmation` (waiting on the
     * mentor) once Paystack confirms the charge — there is no separate
     * "grant" step the way credits/passes have one, because the thing being
     * sold (a specific slot) was already reserved at booking.
     *
     * `.eq("status", "pending_payment")` is a second, independent layer of
     * idempotency on top of this function's own top-level
     * `transaction.status !== "pending"` guard: that guard already stops a
     * webhook redelivery from reaching this branch twice for the same
     * payment_transactions row, but this makes the SESSION-side state change
     * itself a no-op if it were ever somehow reached twice — the same
     * belt-and-braces reasoning as credit_ad_wallet's own reference-based
     * unique index backing up the guard above it. A webhook redelivery can
     * therefore never double-book or double-charge a session: fulfilment
     * itself is blocked at the top, and even a bypass of that lands on a
     * conditional UPDATE that only ever fires once.
     */
    const { data: session } = await supabase
      .from("mentorship_sessions")
      .update({ status: "awaiting_confirmation", updated_at: new Date().toISOString() })
      .eq("id", transaction.product_id)
      .eq("status", "pending_payment")
      .select("session_type")
      .maybeSingle();
    if (session) {
      purchased = `Mentorship session (${session.session_type.replace(/_/g, " ")})`;
    }
  }

  // Reached only by talent_directory_subscription, ad_wallet_topup and
  // mentor_session — credit_pack/pass return early above, already flipped to
  // "success" atomically with their grant (migration 0159, send-228).
  //
  // Marked success only after the grant above has run. Ordering matches the
  // original code deliberately: flipping status first would close the
  // webhook/callback double-grant race but replace it with a worse one — a
  // crash in between would leave the user charged, unfulfilled, and unable to
  // retry (the "pending" guard above would short-circuit). ad_wallet_topup
  // has its own separate defence (a unique index on paystack_reference,
  // see that branch's own comment); talent_directory_subscription and
  // mentor_session each already guard their OWN row's state transition with
  // a conditional `.eq("status", "pending_payment")` UPDATE, which is
  // already race-safe for that row — what remains genuinely non-atomic here
  // is only the unconditional `payment_transactions` status flip below,
  // which for these three product types carries no grant of its own to
  // double up on. Out of scope for send-228, which was scoped to
  // credit_pack/pass specifically.
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
  const amountText = `₦${args.amountNgn.toLocaleString()}`;
  const billingUrl = absoluteUrl("/billing");

  const receiptBox = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
      <tr><td style="padding:4px 0;font:400 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#5a4a3f;">What you bought</td>
          <td style="padding:4px 0;font:600 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#2b2119;text-align:right;">${escEmail(args.productName)}</td></tr>
      <tr><td style="padding:4px 0;font:400 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#5a4a3f;">Amount</td>
          <td style="padding:4px 0;font:600 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#2b2119;text-align:right;">${escEmail(amountText)}</td></tr>
      <tr><td style="padding:4px 0;font:400 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#5a4a3f;">Receipt number</td>
          <td style="padding:4px 0;font:600 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#2b2119;text-align:right;">${escEmail(args.reference)}</td></tr>
    </table>`;

  await resend.emails.send({
    from: "Talentrah <billing@talentrah.com>",
    to: profile.email,
    subject: `Your Talentrah purchase — ${args.productName}`,
    text:
      `Hi${greeting ? ` ${greeting}` : ""},\n\n` +
      `Thanks — your payment went through.\n\n` +
      `What you bought: ${args.productName}\n` +
      `Amount: ${amountText}\n` +
      `Receipt number: ${args.reference}\n\n` +
      `Quote the receipt number if you ever need to ask us about this payment. ` +
      `You can see all your purchases on your Billing page.\n\n— Talentrah`,
    html: renderBrandedEmail({
      bodyHtml: [
        emailParagraph(`Hi${greeting ? ` ${escEmail(greeting)}` : ""},`),
        emailParagraph("Thanks — your payment went through."),
        receiptBox,
        emailParagraph(
          `Quote the receipt number if you ever need to ask us about this payment. You can see all your purchases on your <a href="${escEmail(billingUrl)}" style="color:#6b4a3a;">Billing page</a>.`,
        ),
        emailParagraph("— Talentrah"),
      ].join("\n"),
    }),
  });
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
