/**
 * The preferences reachable from the one-click unsubscribe link.
 *
 * `email_preferences` (0083) carries independently-flippable columns, each
 * with its OWN RPC (0083's `email_unsubscribe` for the digest, 0128's
 * `proactive_match_alert_set_preference` for send-138's alert, 0198's
 * `win_back_email_set_preference` for send-467's win-back email) rather than
 * one generalised function — see 0128's own header for why. `pref` in the
 * unsubscribe URL selects which; omitted, it defaults to the digest for
 * backward compatibility with every digest email already sent before this
 * existed.
 */
export type UnsubscribablePreference = "job_match_digest" | "proactive_match_alert" | "win_back_email";

export const DEFAULT_PREFERENCE: UnsubscribablePreference = "job_match_digest";

export function parsePreference(raw: string | undefined): UnsubscribablePreference {
  if (raw === "proactive_match_alert") return "proactive_match_alert";
  if (raw === "win_back_email") return "win_back_email";
  return DEFAULT_PREFERENCE;
}
