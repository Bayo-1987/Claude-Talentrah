"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/require-admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/lib/supabase/types";
import type { OperatorActionState } from "./state";

type Perm = Database["public"]["Enums"]["admin_permission"];

/**
 * Creating, renaming, re-permissioning and deleting roles.
 *
 * NONE OF THE RULES LIVE HERE. admin_upsert_role and admin_delete_role (0075)
 * hold the mutex, re-check the actor, and enforce the coverage invariant in
 * the same statement that writes. This module reads a form, calls one of them,
 * turns a reason code into a sentence, and writes the audit row.
 *
 * That division is the point. Editing a role's permissions can remove
 * `operators` from the only role that has it, and deleting one can do the same
 * — both are coverage mutations, and a check performed here, before the call,
 * would be exactly the read-then-act shape spend_credits_atomic exists to
 * prevent.
 */

const REFUSALS: Record<string, string> = {
  not_authorised: "You need the Operators permission to manage roles.",
  name_required: "Give the role a name.",
  name_taken: "A role with that name already exists.",
  not_found: "That role no longer exists — reload the page.",
  builtin: "Built-in roles cannot be deleted. Rename it or change its permissions instead.",
  role_in_use:
    "Somebody still has that role. Move them to another role first — this will not reassign people for you.",
  last_operator_admin:
    "That would leave nobody able to manage operators. Give someone else a role granting Operators first.",
};

export async function saveRoleAction(
  _prev: OperatorActionState,
  formData: FormData,
): Promise<OperatorActionState> {
  const actor = await requirePermission("operators");

  const roleId = String(formData.get("roleId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  // Checkboxes: only the ticked ones are submitted, so an empty set is a
  // legitimate answer (a role that grants nothing) rather than a missing field.
  const permissions = formData.getAll("permissions").map(String) as Perm[];
  const targetId = roleId || "new-role";

  if (!name) return { status: "error", message: REFUSALS.name_required, targetId };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("admin_upsert_role", {
    p_actor: actor.adminId,
    p_role_id: roleId || (undefined as unknown as string),
    p_name: name,
    p_permissions: permissions,
  });

  if (error) {
    console.error("[admin-roles] upsert failed", error);
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

  await recordAdminAction({
    identity: actor,
    action: roleId ? "role.updated" : "role.created",
    targetTable: "admin_roles",
    targetId: row.role_id,
    // The resulting permission set, sorted, so a diff between two audit rows
    // is readable rather than an ordering artefact.
    detail: { name, permissions: [...permissions].sort() },
  });

  revalidatePath("/admin/operators");
  return { status: "success", message: roleId ? "Role saved." : `Created ${name}.`, targetId };
}

export async function deleteRoleAction(
  _prev: OperatorActionState,
  formData: FormData,
): Promise<OperatorActionState> {
  const actor = await requirePermission("operators");
  const roleId = String(formData.get("roleId") ?? "");
  if (!roleId) return { status: "error", message: "Missing role.", targetId: "new-role" };

  const supabase = createServiceRoleClient();

  // Read the name BEFORE deleting: the audit row is the only place it will
  // still exist afterwards, and "deleted a role" without saying which is not a
  // trail.
  const { data: before } = await supabase
    .from("admin_roles").select("name").eq("id", roleId).maybeSingle();

  const { data, error } = await supabase.rpc("admin_delete_role", {
    p_actor: actor.adminId,
    p_role_id: roleId,
  });

  if (error) {
    console.error("[admin-roles] delete failed", error);
    return { status: "error", message: "Something went wrong on our end.", targetId: roleId };
  }
  const row = data?.[0];
  if (!row?.ok) {
    return {
      status: "error",
      message: REFUSALS[row?.reason ?? ""] ?? "That role could not be deleted.",
      targetId: roleId,
    };
  }

  await recordAdminAction({
    identity: actor,
    action: "role.deleted",
    targetTable: "admin_roles",
    targetId: roleId,
    detail: { name: before?.name ?? null },
  });

  revalidatePath("/admin/operators");
  return { status: "success", message: `Deleted ${before?.name ?? "the role"}.`, targetId: roleId };
}
