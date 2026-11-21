import { NOTIFICATION_RPCS } from "@/lib/notifications/contract-db";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { streamOf, type UnsubscribablePreference } from "./preference";

/**
 * The ONE place a preference is switched by token, for every route that does it: the confirm button, the one-click POST, and the undo. Nothing that answers a GET may import this file
 * (tests/notifications/unsubscribe-confirm-and-post.test.tsx reads the page's source for exactly that).
 *
 * `subscribed` false turns the kind off, true turns it back on. The kinds have differently shaped functions (`p_subscribed` vs `p_enabled`, and the stream function for the two mass-mail kinds), so each is
 * called by its own shape; see actions.ts and 0083, 0128, 0197, 0200 and 0265 for why. No session: the token in the link is the authorisation, which is why it is 32 random bytes.
 *
 * Returns "done" when the token matched, "unmatched" when no row has it (nothing was changed), "failed" on a database error (logged, never with the token).
 */
export type PreferenceResult = "done" | "unmatched" | "failed";

export async function setPreference(token: string, preference: UnsubscribablePreference, subscribed: boolean, logLabel: string): Promise<PreferenceResult> {
  if (!token) return "unmatched";
  const supabase = createServiceRoleClient();
  const stream = streamOf(preference);
  const { data, error } =
    stream !== null
      ? await supabase.rpc(NOTIFICATION_RPCS.emailUnsubscribeStream, { p_token: token, p_stream: stream, p_subscribed: subscribed })
      : preference === "proactive_match_alert"
        ? await supabase.rpc("proactive_match_alert_set_preference", { p_token: token, p_enabled: subscribed })
        : preference === "scholarship_deadline_alert"
          ? await supabase.rpc("scholarship_deadline_alert_set_preference", { p_token: token, p_enabled: subscribed })
          : preference === "win_back_email"
            ? await supabase.rpc("win_back_email_set_preference", { p_token: token, p_enabled: subscribed })
            : await supabase.rpc("email_unsubscribe", { p_token: token, p_subscribed: subscribed });
  if (error) {
    console.error(`[unsubscribe] ${logLabel} failed:`, error.message);
    return "failed";
  }
  return data?.[0]?.matched === true ? "done" : "unmatched";
}
