"use server";

import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Re-subscribe using the same token the unsubscribe link carried.
 *
 * Takes only the token — there is no session here, deliberately. Returns a
 * plain boolean rather than the row, so nothing about who the token belongs to
 * reaches the browser.
 */
export async function resubscribeAction(token: string): Promise<boolean> {
  if (!token) return false;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("email_unsubscribe", {
    p_token: token,
    p_subscribed: true,
  });
  if (error) {
    console.error("[unsubscribe] resubscribe failed:", error.message);
    return false;
  }
  return data?.[0]?.matched === true;
}
