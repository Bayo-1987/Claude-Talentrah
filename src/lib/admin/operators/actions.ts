"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/admin/require-admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { OperatorActionState } from "./state";

/**
 * Change an operator's role, or enable/disable them.
 *
 * BOTH GO THROUGH ONE DATABASE FUNCTION and neither is written from here.
 * admin_update_operator (0073) holds the lock, re-checks the actor, and
 * enforces the one invariant that matters — that this cannot leave zero active
 * super admins. Doing the count in JavaScript and then writing would be the
 * same read-then-act shape that let `spendCredits` double-spend for months:
 * two operators demoting each other at the same moment would both read "there
 * are two of us" and both commit.
 *
 * The refusal is not a nicety. If it ever failed, nobody could reach
 * /admin/operators to undo it, because the page that fixes it is the page the
 * guard just locked. Recovery would be a service-role intervention.
 */

const REFUSALS: Record<string, string> = {
  last_super_admin:
    "That would leave nobody with Super Admin. Promote someone else first, then come back.",
  not_authorised: "Only a Super Admin can change operator access.",
  not_found: "That operator no longer exists — reload the page.",
  bad_role: "Unknown role.",
  no_change: "Nothing to change — that is already the current state.",
};

async function update(
  targetId: string,
  change: { role?: "super_admin" | "standard"; disabled?: boolean },
): Promise<OperatorActionState> {
  const actor = await requireSuperAdmin();

  if (!targetId) {
    return { status: "error", message: "Missing operator.", targetId };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("admin_update_operator", {
    p_actor: actor.adminId,
    p_target: targetId,
    p_role: change.role ?? undefined,
    p_disabled: change.disabled ?? undefined,
  });

  if (error) {
    console.error("[admin-operators] update failed", error);
    return { status: "error", message: "Something went wrong on our end.", targetId };
  }

  const row = data?.[0];
  if (!row?.ok) {
    return {
      status: "error",
      message: REFUSALS[row?.reason ?? ""] ?? "That change was refused.",
      targetId,
    };
  }

  /*
   * Logged AFTER the write succeeds, with what actually changed rather than
   * what was asked for — the function may normalise (re-disabling an already
   * disabled operator keeps the original timestamp), and a trail that records
   * the request rather than the outcome is a trail of intentions.
   */
  await recordAdminAction({
    identity: actor,
    action: change.role !== undefined ? "operator.role_changed" : "operator.access_changed",
    targetTable: "admin_users",
    targetId,
    detail: {
      role: row.new_role,
      disabled: row.new_disabled_at !== null,
      disabled_at: row.new_disabled_at,
    },
  });

  revalidatePath("/admin/operators");
  return { status: "success", message: "Saved.", targetId };
}

export async function setOperatorRoleAction(
  _prev: OperatorActionState,
  formData: FormData,
): Promise<OperatorActionState> {
  const id = String(formData.get("id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (role !== "super_admin" && role !== "standard") {
    return { status: "error", message: "Unknown role.", targetId: id };
  }
  return update(id, { role });
}

export async function setOperatorAccessAction(
  _prev: OperatorActionState,
  formData: FormData,
): Promise<OperatorActionState> {
  const id = String(formData.get("id") ?? "");
  const action = String(formData.get("access") ?? "");
  if (action !== "disable" && action !== "enable") {
    return { status: "error", message: "Unknown action.", targetId: id };
  }
  return update(id, { disabled: action === "disable" });
}
