import "server-only";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PaystackDeclineError, verifyTransaction } from "@/lib/paystack/client";

/**
 * Before a second checkout is started for a mentor booking that already has an open payment reference, look at what Paystack says about the earlier one. Every click on Pay used to mint a new
 * reference for the same `pending_payment` booking, so an impatient re-click while a bank transfer was still settling could produce two payments for one session.
 *
 *   paid       Paystack says the earlier reference WAS paid (the webhook has not arrived): the caller fulfils it instead of starting another checkout.
 *   in_flight  the earlier reference is still being paid (pending, ongoing, processing, queued): no second checkout until it settles.
 *   unknown    Paystack could not be asked, or answered with a status this code does not know: no second checkout (fail closed, a refused click costs nobody money and a second charge does).
 *   none       there is no earlier reference, or every one is abandoned, failed, reversed or unknown to Paystack: a new checkout is fine.
 *
 * At most the three newest pending references are looked at, so a booking with a long history of abandoned checkouts costs at most three read-only calls, and only when there is one to ask about.
 */
export type OpenPayment = { kind: "none" } | { kind: "paid"; reference: string } | { kind: "in_flight" } | { kind: "unknown" };

const IN_FLIGHT = new Set(["pending", "ongoing", "processing", "queued"]);
const NOT_PAYING = new Set(["abandoned", "failed", "reversed"]);

export async function findOpenSessionPayment(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  sessionId: string,
  userId: string,
): Promise<OpenPayment> {
  const { data: rows, error } = await serviceClient
    .from("payment_transactions")
    .select("paystack_reference")
    .eq("product_type", "mentor_session")
    .eq("product_id", sessionId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .not("paystack_reference", "is", null)
    .order("created_at", { ascending: false })
    .limit(3);
  if (error) return { kind: "unknown" };

  let verdict: OpenPayment = { kind: "none" };
  for (const row of rows ?? []) {
    const reference = row.paystack_reference as string;
    let status: string;
    try {
      status = (await verifyTransaction(reference)).status;
    } catch (err) {
      // Paystack answering 404 means it never heard of the reference (initialisation failed after the row was written): not an open payment.
      if (err instanceof PaystackDeclineError && err.status === 404) continue;
      if (verdict.kind !== "in_flight") verdict = { kind: "unknown" };
      continue;
    }
    if (status === "success") return { kind: "paid", reference };
    if (IN_FLIGHT.has(status)) verdict = { kind: "in_flight" };
    else if (!NOT_PAYING.has(status) && verdict.kind === "none") verdict = { kind: "unknown" };
  }
  return verdict;
}
