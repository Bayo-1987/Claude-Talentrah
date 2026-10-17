"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/require-admin";
import { attemptPayout } from "@/lib/mentorship/payouts";

/**
 * The manual-retry path for a `failed` payout. Deliberately calls the SAME
 * `attemptPayout` the cron loop calls — no separate "admin retry" code path
 * to duplicate or drift from the cron's own idempotency guarantees.
 * `attemptPayout`'s own claim step (`claim_mentor_payout`, 0149) is what
 * makes it safe to call this even if the cron happens to be mid-run against
 * the same row at the same moment: at most one of the two ever wins the
 * claim.
 *
 * No row-status validation here beyond the permission check — none is
 * needed. Calling attemptPayout on a `paid` or currently-`processing` row is
 * harmless: the claim simply matches nothing and `not_eligible` comes back.
 * That is the point of the atomic-claim design — this Server Action does not
 * have to re-derive "is this actually retryable" as a second, separate
 * check that could disagree with the database's own answer.
 */
export async function retryMentorPayoutAction(payoutId: string): Promise<{ status: "ok" | "not_eligible" | "error"; message: string }> {
  await requirePermission("mentor_review");

  try {
    const outcome = await attemptPayout(payoutId);
    revalidatePath("/admin/mentor-payouts");

    switch (outcome.outcome) {
      case "paid":
        return { status: "ok", message: "Paid." };
      case "indeterminate":
        return { status: "ok", message: "Paystack hasn't confirmed an outcome yet — it will resolve on the next run." };
      case "failed":
        return { status: "ok", message: `Still failing: ${outcome.reason}` };
      // The outcomes below mean the record and Paystack may disagree. None of them is "Paid." and none is "nothing to retry".
      case "paid_unrecorded":
        return {
          status: "error",
          message: "Paystack shows this transfer as paid, but we could not record it. Do not retry. The payout id and the Paystack reference are in the server log.",
        };
      case "failure_unrecorded":
        return { status: "error", message: "The attempt failed and we could not record that, so the payout may still show as in progress. See the server log." };
      case "indeterminate_unrecorded":
        return { status: "error", message: "Paystack has not confirmed an outcome and we could not record that. The reference is still on the payout. See the server log." };
      case "reference_unsaved":
        return { status: "error", message: "We could not save the transfer reference, so nothing was sent. Try again in a moment." };
      case "needs_review":
        return {
          status: "error",
          message:
            "This payout was left in progress with no Paystack reference on record, so it cannot be retried safely: the first transfer may already have gone out. Nothing was sent. Check Paystack's dashboard for this mentor and amount, then record the result by hand.",
        };
      case "not_eligible":
        return { status: "not_eligible", message: "Nothing to retry — it may already be paid or mid-attempt." };
    }
  } catch (err) {
    console.error("[admin-mentor-payouts] retry failed", err);
    return { status: "error", message: "Something went wrong on our end." };
  }
}
