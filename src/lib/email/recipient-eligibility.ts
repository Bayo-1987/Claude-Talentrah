/**
 * Who may be emailed, in one place (EMP-1 / E3; ACCT-1 extends it).
 *
 * Eligibility is three conditions, and nothing else is pretended:
 *
 *   the profile exists          a deleted account has no `profiles` row, so a user id we asked about and got no row for is skipped as "deleted".
 *   it is not scheduled for deletion   the owner confirmed ACCT-1 deletion (`profiles.deletion_requested_at` is set). They asked us to stop, and
 *                               the account is hidden everywhere; "stop all email" is part of that. Restoring clears the flag and mail resumes.
 *   the email is not blank
 *
 * THIS IS THE QUESTION A SENDER ASKS BEFORE IT DOES WORK (claims a reminder, builds a digest). The backstop that covers EVERY sender, including ones
 * written later, is the guard in `getResendClient()` (src/lib/resend/client.ts), which drops a recipient whose profile carries the flag at the moment of
 * sending. Both read the same column.
 *
 * ── WHY NO OPT-OUT IS CHECKED (looked for, not assumed) ───────────────────
 *
 * `email_preferences` holds per-STREAM opt-outs for OPTIONAL mail: the weekly digest, the proactive match alert, the scholarship deadline alert,
 * the win-back email, the employer-resume-view notice, the auto-apply digest. Each is a column its own sender reads. The transactional sends
 * (employer verification reminders, hired-moment, talent-directory contact email, mentorship reminders) are deliberately NOT gated on it, and each
 * says so in its own header; the privacy page tells people that opting out of the digest still leaves "messages about your account". The closing-date
 * reminder is a transactional note about the employer's own posting, with no preference column of its own and no unsubscribe link, so it follows
 * them. There is no account-wide "stop all email" flag other than the deletion flag above.
 */

export interface RecipientProfile {
  id: string;
  email: string | null;
  first_name?: string | null;
  /** `profiles.deletion_requested_at`. A caller that selects it gets the deletion rule; one that does not is covered by the send-time guard. */
  deletion_requested_at?: string | null;
}

export type RecipientSkipReason = "no_email" | "deleted" | "deleted_pending";

export function recipientSkipReason(profile: Pick<RecipientProfile, "email" | "deletion_requested_at">): RecipientSkipReason | null {
  if (profile.deletion_requested_at) return "deleted_pending";
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
