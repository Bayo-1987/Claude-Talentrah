/**
 * The emails an account deletion sends ABOUT ITSELF to the person whose account is (or is about to be) scheduled for deletion.
 *
 * The guard in `getResendClient()` drops every email to an account with `deletion_requested_at` set, which is what stops the digests, reminders and
 * alerts. These three are the exception, because their whole point is to reach that person: the link they asked for, the proof that it worked, and the
 * proof that it was undone. They are the ONLY exception, and the way in is the lifecycle sender in client.ts, not an option on the ordinary client: a
 * normal send that names one of these templates is still dropped.
 *
 * Adding a name here is a decision about whose inbox can be written to after they asked to leave, so docs/account-deletion-map.md must list it under
 * "Deletion-lifecycle emails"; tests/email/every-sender-uses-the-guarded-client.test.ts fails when the list and the document disagree.
 */
export const DELETION_LIFECYCLE_TEMPLATES = ["deletion_confirm", "deletion_scheduled", "deletion_restored"] as const;

export type DeletionLifecycleTemplate = (typeof DELETION_LIFECYCLE_TEMPLATES)[number];

export function isDeletionLifecycleTemplate(value: unknown): value is DeletionLifecycleTemplate {
  return typeof value === "string" && (DELETION_LIFECYCLE_TEMPLATES as readonly string[]).includes(value);
}

/** The header the lifecycle sender stamps on the mail, so the message itself says what it is. */
export const LIFECYCLE_TEMPLATE_HEADER = "X-Talentrah-Template";
