"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { initializeTransaction, NGN_CHANNELS } from "@/lib/paystack/client";
import { requireEmployer } from "@/lib/employer/membership";
import type { EmployerActionState } from "@/lib/employer/actions";

/** Mirrors billing/actions.ts — same derivation, same reason. */
async function getOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

/**
 * Roles permitted to spend the organisation's money (plan doc §7.4).
 * Same list, same reasoning, as campaign-actions.ts — see the note there on
 * why this check lives in the Server Action layer and what it does and does
 * not currently restrict.
 */
const SPEND_ROLES = ["owner", "admin"] as const;

/** Anchors from the plan doc; a top-up must be a whole number of naira. */
const MIN_TOPUP_NGN = 1_000;
const MAX_TOPUP_NGN = 5_000_000;

export async function topUpWalletAction(
  _prev: EmployerActionState,
  form: FormData,
): Promise<EmployerActionState> {
  const context = await requireEmployer();
  if (!SPEND_ROLES.includes(context.role as (typeof SPEND_ROLES)[number])) {
    return { error: "You don't have permission to manage billing for this company." };
  }

  // Paystack requires an email to open a transaction, and it is also where
  // the receipt goes. A session without one cannot be charged, and failing
  // here is better than sending Paystack a placeholder.
  if (!context.userEmail) {
    return { error: "Add an email to your account before topping up." };
  }

  const raw = String(form.get("amount") ?? "").replace(/[^0-9]/g, "");
  const amount = Number(raw);
  if (!Number.isInteger(amount) || amount < MIN_TOPUP_NGN) {
    return { error: `Top up at least ₦${MIN_TOPUP_NGN.toLocaleString("en-NG")}.` };
  }
  if (amount > MAX_TOPUP_NGN) {
    return { error: `That's above the ₦${MAX_TOPUP_NGN.toLocaleString("en-NG")} single top-up limit.` };
  }

  /*
   * THE REFERENCE IS THE IDEMPOTENCY KEY, and it is minted here — once, before
   * anything is charged — rather than derived later from Paystack's response.
   *
   * `credit_ad_wallet` dedupes on `ad_wallet_ledger_topup_reference_idx`,
   * UNIQUE on `paystack_reference` WHERE paystack_reference IS NOT NULL. The
   * whole chain only holds if the SAME string reaches Paystack, the
   * payment_transactions row, and eventually credit_ad_wallet. Minting it here
   * and passing it through is what makes a duplicate webhook a no-op instead
   * of a second credit. Generating a fresh id at fulfilment time would look
   * identical and silently double-credit.
   */
  const reference = `ad_wallet_topup_${randomUUID()}`;
  const origin = await getOrigin();

  // Service role: payment_transactions has no authenticated insert policy
  // (0006_commerce) — only trusted server code writes these. Same as
  // initiatePurchaseAction.
  const service = createServiceRoleClient();
  const { error: insertError } = await service.from("payment_transactions").insert({
    user_id: context.userId,
    organization_id: context.organization.id,
    rail: "paystack",
    amount,
    currency: "NGN",
    product_type: "ad_wallet_topup",
    // No product row exists for a top-up. 0050 made this nullable and added a
    // CHECK requiring organization_id and paystack_reference instead, so the
    // row still cannot be half-described.
    product_id: null,
    paystack_reference: reference,
    status: "pending",
  });
  if (insertError) {
    return { error: `Couldn't start the top-up: ${insertError.message}` };
  }

  let authorizationUrl: string;
  try {
    const init = await initializeTransaction({
      email: context.userEmail,
      amountNgn: amount,
      reference,
      callbackUrl: `${origin}/employer/campaigns/topup-callback`,
      metadata: {
        productType: "ad_wallet_topup",
        organizationId: context.organization.id,
        userId: context.userId,
      },
      channels: NGN_CHANNELS,
    });
    authorizationUrl = init.authorization_url;
  } catch {
    // Marked failed so the pending row does not sit forever looking like a
    // charge of unknown outcome — which, per 0043, is a meaningfully different
    // state from a failure and should not be confused with one.
    await service
      .from("payment_transactions")
      .update({ status: "failed" })
      .eq("paystack_reference", reference);
    return { error: "Couldn't reach Paystack just now. Try again in a moment." };
  }

  redirect(authorizationUrl);
}
