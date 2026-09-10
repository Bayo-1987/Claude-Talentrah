/**
 * The preferences reachable from the one-click unsubscribe link.
 *
 * `email_preferences` (0083) carries independently-flippable columns, each
 * with its OWN RPC (0083's `email_unsubscribe` for the digest, 0128's
 * `proactive_match_alert_set_preference` for send-138's alert) rather than
 * one generalised function — see 0128's own header for why. `pref` in the
 * unsubscribe URL selects which; omitted, it defaults to the digest for
 * backward compatibility with every digest email already sent before this
 * existed.
 */
export type UnsubscribablePreference = "job_match_digest" | "proactive_match_alert";

export const DEFAULT_PREFERENCE: UnsubscribablePreference = "job_match_digest";

export function parsePreference(raw: string | undefined): UnsubscribablePreference {
  return raw === "proactive_match_alert" ? "proactive_match_alert" : DEFAULT_PREFERENCE;
}
