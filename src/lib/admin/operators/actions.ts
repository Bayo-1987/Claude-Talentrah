"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/require-admin";
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
  last_operator_admin:
    "That would leave nobody able to manage operators. Give someone else a role granting Operators first, then come back.",
  unknown_role: "That role no longer exists — reload the page.",
  not_authorised: "Only a Super Admin can change operator access.",
  not_found: "That operator no longer exists — reload the page.",
  bad_role: "Unknown role.",
  no_change: "Nothing to change — that is already the current state.",
};

async function update(
  targetId: string,
  change: { roleId?: string | null; disabled?: boolean },
): Promise<OperatorActionState> {
  const actor = await requirePermission("operators");

  if (!targetId) {
    return { status: "error", message: "Missing operator.", targetId };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("admin_set_operator", {
    p_actor: actor.adminId,
    p_target: targetId,
    p_role_id: change.roleId ?? undefined,
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
    action: change.roleId !== undefined ? "operator.role_changed" : "operator.access_changed",
    targetTable: "admin_users",
    targetId,
    detail: { role_id: change.roleId ?? null, disabled: change.disabled ?? null },
  });

  revalidatePath("/admin/operators");
  return { status: "success", message: "Saved.", targetId };
}

export async function setOperatorRoleAction(
  _prev: OperatorActionState,
  formData: FormData,
): Promise<OperatorActionState> {
  const id = String(formData.get("id") ?? "");
  const roleId = String(formData.get("roleId") ?? "");
  return update(id, { roleId: roleId === "" ? null : roleId });
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
