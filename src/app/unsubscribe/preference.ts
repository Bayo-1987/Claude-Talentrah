/**
 * The preferences reachable from the one-click unsubscribe link.
 *
 * `email_preferences` (0083) carries independently-flippable columns, each
 * with its OWN RPC (0083's `email_unsubscribe` for the digest, 0128's
 * `proactive_match_alert_set_preference` for send-138's alert, 0197's
 * `scholarship_deadline_alert_set_preference` for send-466's deadline
 * reminder, 0200's `win_back_email_set_preference` for send-467's win-back
 * email) rather than one generalised function — see 0128's own header for
 * why. `pref` in the unsubscribe URL selects which; omitted, it defaults to
 * the digest for backward compatibility with every digest email already sent
 * before this existed.
 *
 * Two more kinds are not columns with their own function but the two STREAMS of mass e-mail the admin messages send (0265): `announcements` (service notices) and `promotions` (offers). Both
 * go through the one function the stream function from migration 0265 (reached through the notifications accessor); `streamOf` names the stream, or null for the four older kinds. An unknown or missing `pref` is still
 * the weekly digest, exactly as before; only these two exact values are new.
 */
export type UnsubscribablePreference =
  | "job_match_digest"
  | "proactive_match_alert"
  | "scholarship_deadline_alert"
  | "win_back_email"
  | "announcements"
  | "promotions";

export const DEFAULT_PREFERENCE: UnsubscribablePreference = "job_match_digest";

export function parsePreference(raw: string | undefined): UnsubscribablePreference {
  if (raw === "proactive_match_alert") return "proactive_match_alert";
  if (raw === "scholarship_deadline_alert") return "scholarship_deadline_alert";
  if (raw === "win_back_email") return "win_back_email";
  if (raw === "announcements") return "announcements";
  if (raw === "promotions") return "promotions";
  return DEFAULT_PREFERENCE;
}

/** The stream argument of the 0265 stream function for the two mass-mail kinds, or null for the four that have their own function. */
export function streamOf(preference: UnsubscribablePreference): "announcements" | "promotions" | null {
  return preference === "announcements" || preference === "promotions" ? preference : null;
}
