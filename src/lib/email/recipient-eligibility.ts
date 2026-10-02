/**
 * Who may be emailed, in one place.
 *
 * Written for the closing-date reminder (EMP-1 / E3) and meant to be the thing every sender asks, so that account
 * deletion, deactivation and unsubscribing (ACCT-1) only have to teach ONE file about a new state.
 *
 * ── WHAT EXISTS TODAY, AND WHAT IS READ AHEAD OF IT ───────────────────────
 *
 * `profiles` currently has none of `deleted_at`, `deactivated_at` or `email_unsubscribed_at`. What does exist:
 *
 *   deleted      a deleted account has no `profiles` row, so the caller simply never gets one for that user id.
 *                selectEmailableRecipients treats "asked for, not returned" as deleted. This one is real today.
 *   no email     a profile with a blank email cannot be mailed.
 *   deactivated / unsubscribed / deleted_at
 *                optional fields on the row. They are read when present and ignored when absent, so the day a column
 *                of that name appears (and the sender selects it) the person is skipped here with no sender edited.
 *                The names are the obvious ones, not a decision: ACCT-1 should rename them HERE if it chooses others.
 *
 * `email_preferences` is deliberately not consulted: its columns are per-kind opt-outs for optional mail (the digest,
 * the win-back email, ...). This reminder is transactional, about the employer's own posting, and has no kind of its
 * own, the same as the verification reminder.
 */

export interface RecipientProfile {
  id: string;
  email: string | null;
  first_name?: string | null;
  deleted_at?: string | null;
  deactivated_at?: string | null;
  email_unsubscribed_at?: string | null;
}

export type RecipientSkipReason = "no_email" | "deleted" | "deactivated" | "unsubscribed";

export function recipientSkipReason(
  profile: Pick<RecipientProfile, "email" | "deleted_at" | "deactivated_at" | "email_unsubscribed_at">,
): RecipientSkipReason | null {
  if (profile.deleted_at) return "deleted";
  if (profile.deactivated_at) return "deactivated";
  if (profile.email_unsubscribed_at) return "unsubscribed";
  if (!profile.email || !profile.email.trim()) return "no_email";
  return null;
}

export interface EmailableRecipient {
  userId: string;
  email: string;
  firstName: string | null;
}

/**
 * Of the user ids we WANT to mail, who can be, and why not for the rest. A wanted id with no profile row is a deleted
 * account.
 */
export function selectEmailableRecipients(
  wantedUserIds: string[],
  profiles: RecipientProfile[],
): { recipients: EmailableRecipient[]; skipped: Array<{ userId: string; reason: RecipientSkipReason }> } {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const recipients: EmailableRecipient[] = [];
  const skipped: Array<{ userId: string; reason: RecipientSkipReason }> = [];

  for (const userId of [...new Set(wantedUserIds)]) {
    const profile = byId.get(userId);
    if (!profile) {
      skipped.push({ userId, reason: "deleted" });
      continue;
    }
    const reason = recipientSkipReason(profile);
    if (reason) skipped.push({ userId, reason });
    else recipients.push({ userId, email: profile.email!.trim(), firstName: profile.first_name ?? null });
  }
  return { recipients, skipped };
}
