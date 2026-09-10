"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireEmployer } from "@/lib/employer/membership";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { initializeTransaction, NGN_CHANNELS } from "@/lib/paystack/client";

/** Same roles/reasoning as topUpWalletAction — spending the org's money. */
const SPEND_ROLES = ["owner", "admin"] as const;

async function getOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

/**
 * Purchases the org's Talent Directory subscription — a fixed-price,
 * fixed-date Pass-style charge (0135's own header explains why), not the
 * ad-wallet's prepaid drawdown.
 *
 * THE ROW STARTS `pending_payment`, NOT `active`. `fulfillPayment`'s new
 * branch (billing/fulfill.ts) is the only thing that ever flips it to
 * `active`, after Paystack actually confirms the charge — mirroring 0132's
 * own `mentor_session` pattern exactly. An earlier version of this action
 * inserted the row as `active` immediately; that would have granted
 * directory access to every org that merely STARTED a checkout, whether or
 * not they ever paid — caught before merge, not by a test.
 *
 * THE ALREADY-ACTIVE CHECK IS HERE, DELIBERATELY BEFORE CHARGING ANYTHING.
 * The partial unique index (`... where status = 'active'`) is still the
 * real, atomic guarantee — this pre-check only exists so a org that already
 * has an active subscription is told so before Paystack ever takes their
 * money, rather than discovering the conflict only once fulfillPayment tries
 * to flip a second row to 'active' and hits that index after a real charge
 * already went through.
 */
export async function purchaseTalentDirectorySubscriptionAction(planId: string) {
  const context = await requireEmployer();
  if (!SPEND_ROLES.includes(context.role as (typeof SPEND_ROLES)[number])) {
    redirect(
      "/employer/talent-directory?error=" +
        encodeURIComponent("You don't have permission to manage billing for this company."),
    );
  }
  if (!context.userEmail) {
    redirect("/employer/talent-directory?error=" + encodeURIComponent("Add an email to your account before subscribing."));
  }

  const serviceClient = createServiceRoleClient();

  const { data: existingActive } = await serviceClient
    .from("talent_directory_subscriptions")
    .select("id")
    .eq("organization_id", context.organization.id)
    .eq("status", "active")
    .maybeSingle();
  if (existingActive) {
    redirect("/employer/talent-directory?error=" + encodeURIComponent("This organisation already has an active subscription."));
  }

  const { data: plan } = await serviceClient
    .from("talent_directory_plans")
    .select("id, price_ngn, duration_days")
    .eq("id", planId)
    .eq("is_active", true)
    .maybeSingle();
  if (!plan) redirect("/employer/talent-directory?error=" + encodeURIComponent("That plan isn't available."));

  const { data: subscription, error: subscriptionError } = await serviceClient
    .from("talent_directory_subscriptions")
    .insert({
      organization_id: context.organization.id,
      plan_id: plan!.id,
      expires_at: new Date(Date.now() + plan!.duration_days * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (subscriptionError || !subscription) {
    redirect("/employer/talent-directory?error=" + encodeURIComponent("Something went wrong on our end."));
  }

  const reference = `talent_directory_subscription_${randomUUID()}`;
  const origin = await getOrigin();
  await serviceClient.from("payment_transactions").insert({
    user_id: context.userId,
    organization_id: context.organization.id,
    rail: "paystack",
    amount: plan!.price_ngn,
    currency: "NGN",
    product_type: "talent_directory_subscription",
    product_id: subscription!.id,
    paystack_reference: reference,
    status: "pending",
  });

  let authorizationUrl: string;
  try {
    const init = await initializeTransaction({
      email: context.userEmail,
      amountNgn: plan!.price_ngn,
      reference,
      callbackUrl: `${origin}/employer/talent-directory/callback`,
      metadata: {
        productType: "talent_directory_subscription",
        productId: subscription!.id,
        organizationId: context.organization.id,
      },
      channels: NGN_CHANNELS,
    });
    authorizationUrl = init.authorization_url;
  } catch {
    await serviceClient.from("payment_transactions").update({ status: "failed" }).eq("paystack_reference", reference);
    // The subscription row is left `pending_payment`, forever — it grants
    // nothing and the already-active check above is what stops a retry from
    // being blocked by it. An abandoned pending_payment row is inert, same
    // reasoning as an abandoned pending mentorship_sessions row.
    redirect("/employer/talent-directory?error=" + encodeURIComponent("Payments are unavailable right now."));
  }

  redirect(authorizationUrl!);
}
