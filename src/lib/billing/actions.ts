"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { initializeTransaction } from "@/lib/paystack/client";

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
