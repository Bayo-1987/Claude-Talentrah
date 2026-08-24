"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { initializeTransaction, NGN_CHANNELS } from "@/lib/paystack/client";
import { cancelPassAutoRenewal } from "@/lib/billing/renewals";

async function getOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

export async function initiatePurchaseAction(
  productType: "credit_pack" | "pass",
  productId: string,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const table = productType === "credit_pack" ? "credit_packs" : "passes";
  const { data: product } = await supabase.from(table).select("*").eq("id", productId).single();
  if (!product) throw new Error("Product not found.");

  const reference = `${productType}_${randomUUID()}`;
  const origin = await getOrigin();

  // Writes via service role: payment_transactions has no authenticated
  // insert policy (see migration 0006_commerce) — only trusted server code
  // creates these.
  const serviceClient = createServiceRoleClient();
  await serviceClient.from("payment_transactions").insert({
    user_id: user.id,
    rail: "paystack",
    amount: product.price_ngn,
    currency: "NGN",
    product_type: productType,
    product_id: productId,
    paystack_reference: reference,
    status: "pending",
  });

  let authorizationUrl: string;
  try {
    const init = await initializeTransaction({
      email: user.email!,
      amountNgn: product.price_ngn,
      reference,
      callbackUrl: `${origin}/billing/callback`,
      metadata: { productType, productId, userId: user.id },
      // Real, selectable rails for an NGN checkout — see NGN_CHANNELS for
      // why "mobile_money" isn't in this list despite being the product
      // concept this app calls mobile money.
      channels: NGN_CHANNELS,
    });
    authorizationUrl = init.authorization_url;
  } catch {
    await serviceClient
      .from("payment_transactions")
      .update({ status: "failed" })
      .eq("paystack_reference", reference);
    // Redirect to a friendly banner instead of letting this throw — an
    // uncaught Server Action error renders Next's generic "This page
    // couldn't load" screen, which is a dead end for the user.
    redirect("/billing?error=payments_unavailable");
  }

  redirect(authorizationUrl);
}

/**
 * Cancel-anytime (fix-prompt §1) — stops future renewal charges on an
 * active card-paid Pass without affecting the currently-active period.
 * Ownership check happens here (authenticated client, RLS-scoped) before
 * handing off to the service-role write in cancelPassAutoRenewal.
 */
export async function cancelAutoRenewAction(userPassId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: userPass } = await supabase
    .from("user_passes")
    .select("id, user_id, auto_renew_status")
    .eq("id", userPassId)
    .single();

  if (!userPass || userPass.user_id !== user.id) {
    throw new Error("Pass not found.");
  }
  if (userPass.auto_renew_status !== "active") {
    // Already canceled/lapsed/never-was-renewing — nothing to do.
    return;
  }

  await cancelPassAutoRenewal(userPassId);
  revalidatePath("/billing");
}
