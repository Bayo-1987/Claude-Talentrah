"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/require-admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { FlagActionState } from "./state";

/**
 * Turn a feature on or off.
 *
 * NO RULE LIVES HERE. admin_set_feature_flag (0081) holds the permission check
 * in the same statement as the write, so a future code path that skips this
 * action cannot flip a flag either. This reads a form, calls it, and turns a
 * reason code into a sentence.
 *
 * There is no "create flag" path, deliberately. Flags are added by migration
 * alongside the code that reads them — a flag invented from a form is a key
 * nothing checks, which looks like a feature switched on and is not.
 */

const REFUSALS: Record<string, string> = {
  not_authorised: "You need the Feature flags permission to change this.",
  unknown_flag: "That flag no longer exists — reload the page.",
  bad_state: "Pick on or off.",
};

export async function setFeatureFlagAction(
  _prev: FlagActionState,
  formData: FormData,
): Promise<FlagActionState> {
  const actor = await requirePermission("feature_flags");

  const key = String(formData.get("key") ?? "");
  const next = String(formData.get("enabled") ?? "");
  if (!key) return { status: "error", message: "Missing flag.", targetKey: key };
  if (next !== "on" && next !== "off") {
    return { status: "error", message: REFUSALS.bad_state, targetKey: key };
  }
  const enabled = next === "on";

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("admin_set_feature_flag", {
    p_actor: actor.adminId,
    p_key: key,
    p_enabled: enabled,
  });

  if (error) {
    console.error("[admin-flags] set failed", error);
    return { status: "error", message: "Something went wrong on our end.", targetKey: key };
  }
  const row = data?.[0];
  if (!row?.ok) {
    return {
      status: "error",
      message: REFUSALS[row?.reason ?? ""] ?? "That change was refused.",
      targetKey: key,
    };
  }

  await recordAdminAction({
    identity: actor,
    action: enabled ? "feature_flag.enabled" : "feature_flag.disabled",
    targetTable: "feature_flags",
    targetId: key,
    detail: { key, enabled },
  });

  revalidatePath("/admin/feature-flags");
  return {
    status: "success",
    message: enabled ? "Turned on." : "Turned off.",
    targetKey: key,
  };
}
