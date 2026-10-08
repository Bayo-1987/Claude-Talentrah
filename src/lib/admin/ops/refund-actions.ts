"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/require-admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { RefundActionState } from "@/lib/admin/ops/refund-state";

/**
 * The last step of the refund runbook (send-502): the operator has refunded the charge in the Paystack dashboard, and marks
 * the mentor session `refunded` so it leaves the ops list and the nav badge.
 *
 * The write is conditional on the session STILL being `payment_needs_refund`, so a double click, or a session that was
 * resolved in the meantime, changes nothing. It does not talk to Paystack: refunding stays a person's decision, in Paystack.
 */
export async function markMentorPaymentRefundedAction(_prev: RefundActionState, formData: FormData): Promise<RefundActionState> {
  const actor = await requirePermission("operations");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return { status: "error", message: "Could not mark that payment refunded: no session was given." };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("mentorship_sessions")
    .update({ status: "refunded", updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("status", "payment_needs_refund")
    .select("id");
  // A rejected write RESOLVES with an error. It is returned to the form (never thrown into the error boundary), and the row stays in the list.
  if (error) {
    console.error(`[admin/ops] could not mark mentor payment refunded (session ${sessionId}): ${error.message}`);
    return { status: "error", message: "Couldn't mark that payment refunded; nothing was changed. The error is in the server log." };
  }

  if ((data ?? []).length === 0) {
    revalidatePath("/admin/ops");
    return { status: "success", message: "That payment was already resolved, so nothing changed." };
  }
  await recordAdminAction({
    identity: actor,
    action: "ops.mentor_payment_marked_refunded",
    targetTable: "mentorship_sessions",
    targetId: sessionId,
  });
  revalidatePath("/admin/ops");
  return { status: "success", message: "Marked refunded. It has left the list and the nav badge." };
}
