import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Json } from "@/lib/supabase/types";
import type { AdminIdentity } from "./session";

/**
 * Writes what an operator did, and as whom.
 *
 * This is the thing the three existing moderation routes could not do. Each of
 * them records `reviewed_by = null` with a comment explaining that a shared
 * secret proves "an operator" and never "which operator", and that recording a
 * caller-supplied id would be worse than a null because a wrong name looks
 * like attribution. With a real session there is a right name, and M2 wires
 * those columns to it.
 *
 * M1 writes only login and logout. That is deliberately not a placeholder:
 * "which admin was signed in, from where, and when" is the record that makes
 * every later attributed action believable.
 *
 * NEVER THROWS. An audit write that fails must not roll back the action it was
 * describing — an admin locked out because the log is unavailable is a worse
 * outcome than a gap in the log, and the gap is visible. Failures go to the
 * server log.
 */
export async function recordAdminAction(input: {
  identity: Pick<AdminIdentity, "adminId" | "email"> & { sessionId?: string | null };
  action: string;
  targetTable?: string | null;
  targetId?: string | null;
  detail?: { [key: string]: Json } | null;
}): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from("admin_audit_log").insert({
      admin_user_id: input.identity.adminId,
      // Snapshotted, not joined for. The FK is ON DELETE SET NULL so the trail
      // survives the account; without the email it would survive as an
      // anonymous row, which is not a trail.
      admin_email: input.identity.email,
      admin_session_id: input.identity.sessionId ?? null,
      action: input.action,
      target_table: input.targetTable ?? null,
      target_id: input.targetId ?? null,
      detail: input.detail ?? null,
    });
    if (error) console.error("[admin-audit] write failed", input.action, error);
  } catch (err) {
    console.error("[admin-audit] write threw", input.action, err);
  }
}

/**
 * A failed sign-in by an address that belongs to a real admin. Logged
 * separately because it is the only one of the two that is worth an alert
 * later.
 *
 * Failures by addresses that are NOT admins are deliberately not recorded at
 * all. Storing every string a stranger types into an admin login form builds a
 * small pile of other people's email addresses in exchange for no signal.
 */
export async function recordFailedAdminLogin(adminId: string, email: string): Promise<void> {
  await recordAdminAction({
    identity: { adminId, email, sessionId: null },
    action: "admin.login_failed",
  });
}
