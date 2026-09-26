"use server";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { UnsubscribablePreference } from "./preference";

/**
 * Re-subscribe using the same token the unsubscribe link carried.
 *
 * Takes only the token — there is no session here, deliberately. Returns a
 * plain boolean rather than the row, so nothing about who the token belongs to
 * reaches the browser.
 *
 * `preference` picks which of the three independently-flippable columns this
 * resubscribes, and therefore which RPC — the functions take differently
 * named parameters (`p_subscribed` vs `p_enabled`), so this calls each by its
 * own shape rather than forcing one call site to guess a shared signature.
 * See 0128's own header for why send-138's alert has its own column and its
 * own function rather than sharing the digest's, and 0197's for send-467's
 * win-back email doing the same.
 */
export async function resubscribeAction(
  token: string,
  preference: UnsubscribablePreference,
): Promise<boolean> {
  if (!token) return false;
  const supabase = createServiceRoleClient();

  const { data, error } =
    preference === "proactive_match_alert"
      ? await supabase.rpc("proactive_match_alert_set_preference", { p_token: token, p_enabled: true })
      : preference === "win_back_email"
        ? await supabase.rpc("win_back_email_set_preference", { p_token: token, p_enabled: true })
        : await supabase.rpc("email_unsubscribe", { p_token: token, p_subscribed: true });

  if (error) {
    console.error("[unsubscribe] resubscribe failed:", error.message);
    return false;
  }
  return data?.[0]?.matched === true;
}
