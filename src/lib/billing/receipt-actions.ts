"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { visibleName } from "@/lib/profile/name";
import { getReceiptMailer } from "@/lib/billing/send-receipt";

/** What the billing page is told, as `?receipt=<code>`. */
export type ReceiptOutcome = "sent" | "limited" | "unavailable" | "failed" | "not_found";

const RESENDABLE = ["credit_pack", "pass"] as const;

const GENERIC_PRODUCT_NAME: Record<string, string> = { credit_pack: "Credit pack", pass: "Talentrah Pass" };

/**
 * "Email me this receipt" for one of the signed-in user's own purchases.
 *
 *   - Everything is read through the SESSION client, so row-level security is what scopes it to the user's own rows (the `user_id`
 *     filter is belt and braces). No service role, and nothing is written: the only state is the rate-limit counter, behind its RPC.
 *   - The recipient is the account's profile email. The action takes a transaction id and nothing else, so no address can be supplied.
 *   - Only SUCCESSFUL credit_pack and pass payments with a Paystack reference. Anything else (pending, failed, an ad wallet top-up, a
 *     mentor session, a Talent Directory subscription) reads as "not found": the page lists only successes, so a request for anything
 *     else did not come from the page.
 *   - Resend not configured is checked FIRST and says so; it does not spend one of the day's five. Five a day per user (`receiptResend`),
 *     failing closed. Resend refusing or throwing says "failed", never "sent".
 *   - Always ends in a redirect to /billing with the outcome, so the page, not this action, decides how to say it.
 */
export async function resendReceiptAction(transactionId: string): Promise<never> {
  redirect(`/billing?receipt=${await run(transactionId)}`);
}

async function run(transactionId: string): Promise<ReceiptOutcome> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const mail = getReceiptMailer();
  if (!mail) return "unavailable";

  const { data: tx } = await supabase
    .from("payment_transactions")
    .select("id, amount, product_type, product_id, paystack_reference")
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .eq("status", "success")
    .maybeSingle();
  if (!tx || !tx.paystack_reference || !(RESENDABLE as readonly string[]).includes(tx.product_type)) return "not_found";

  const limit = await consumeRateLimit(user.id, "receiptResend");
  if (!limit.allowed) return "limited";

  const { data: profile } = await supabase.from("profiles").select("email, first_name").eq("id", user.id).maybeSingle();
  if (!profile?.email) return "failed";

  const table = tx.product_type === "pass" ? "passes" : "credit_packs";
  const { data: product } = tx.product_id
    ? await supabase.from(table).select("name").eq("id", tx.product_id).maybeSingle()
    : { data: null };

  const ok = await mail({
    to: profile.email,
    greeting: visibleName(profile.first_name),
    productName: product?.name ?? GENERIC_PRODUCT_NAME[tx.product_type] ?? tx.product_type,
    productType: tx.product_type,
    amountNgn: tx.amount,
    reference: tx.paystack_reference,
  });
  return ok ? "sent" : "failed";
}
