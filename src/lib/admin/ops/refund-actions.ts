"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/require-admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * The last step of the refund runbook (send-502): the operator has refunded the charge in the Paystack dashboard, and marks
 * the mentor session `refunded` so it leaves the ops list and the nav badge.
 *
 * The write is conditional on the session STILL being `payment_needs_refund`, so a double click, or a session that was
 * resolved in the meantime, changes nothing. It does not talk to Paystack: refunding stays a person's decision, in Paystack.
 */
export async function markMentorPaymentRefundedAction(sessionId: string): Promise<void> {
  const actor = await requirePermission("operations");
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("mentorship_sessions")
    .update({ status: "refunded", updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("status", "payment_needs_refund")
    .select("id");
  if (error) throw new Error(`Could not mark that payment refunded: ${error.message}`);

  if ((data ?? []).length > 0) {
    await recordAdminAction({
      identity: actor,
      action: "ops.mentor_payment_marked_refunded",
      targetTable: "mentorship_sessions",
      targetId: sessionId,
    });
  }
  revalidatePath("/admin/ops");
}
