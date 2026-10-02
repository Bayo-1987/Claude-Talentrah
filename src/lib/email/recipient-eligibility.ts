/**
 * Who may be emailed, in one place. ACCT-1 extends this.
 *
 * Written for the closing-date reminder (EMP-1 / E3). Eligibility today is exactly two conditions, and nothing else is
 * pretended:
 *
 *   the profile exists   a deleted account has no `profiles` row, so a user id we asked about and got no row for is
 *                        skipped as "deleted".
 *   the email is not blank
 *
 * ── WHY NO OPT-OUT IS CHECKED (looked for, not assumed) ───────────────────
 *
 * `email_preferences` holds per-STREAM opt-outs for OPTIONAL mail: the weekly digest, the proactive match alert, the
 * scholarship deadline alert, the win-back email, the employer-resume-view notice, the auto-apply digest. Each is a
 * column its own sender reads. The transactional sends (employer verification reminders, hired-moment, talent-directory
 * contact email, mentorship reminders) are deliberately NOT gated on it, and each says so in its own header; the
 * privacy page tells people that opting out of the digest still leaves "messages about your account". The closing-date
 * reminder is a transactional note about the employer's own posting, with no preference column of its own and no
 * unsubscribe link, so it follows them. There is no account-wide "stop all email" flag, and there is no
 * deactivated or deleted marker on `profiles`: when ACCT-1 adds either, this is the one place to teach about it.
 */

export interface RecipientProfile {
  id: string;
  email: string | null;
  first_name?: string | null;
}

export type RecipientSkipReason = "no_email" | "deleted";

export function recipientSkipReason(profile: Pick<RecipientProfile, "email">): RecipientSkipReason | null {
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
