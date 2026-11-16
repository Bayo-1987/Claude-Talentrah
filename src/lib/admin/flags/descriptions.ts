/**
 * One plain sentence per feature flag, shown under its label on /admin/feature-flags.
 *
 * They live here, in code, keyed by flag key, and not in a database column: a flag is created by a migration, and what it does is reviewed in the same diff as the code that reads it. Each
 * sentence below was written from the code that reads the flag (named beside it), not from the flag's label. tests/admin/feature-flag-descriptions.test.tsx reads every migration and fails when a
 * seeded flag has no entry, and when an entry names a flag no migration seeds, so a new flag cannot ship without saying what it does.
 *
 * A key that is not here (a flag added by hand in the database, say) shows "No description yet" and never throws.
 */
export const FLAG_DESCRIPTIONS = {
  // src/lib/digest/send.ts
  job_match_digest: "Sends each person who has not opted out a weekly email of their best new job matches.",
  // src/lib/notifications/proactive-match-alert/send.ts (run from the job import)
  proactive_match_alert: "Emails a person when a newly added job is an exceptional match for their resume, without waiting for the weekly digest, unless they have opted out.",
  // src/lib/jobs/enrich-thin.ts
  ingest_llm_enrichment:
    "While jobs are imported, asks an AI model to add missing required skills to postings that came in with too few, which sharpens match scores; keep it off until a separate AI account is set up.",
  // src/lib/auto-apply-digest/send.ts
  auto_apply_digest: "Sends the weekly email that reports what Auto-Apply did for each person who has it switched on.",
  // src/lib/scholarship-deadline-alerts/send.ts
  scholarship_deadline_alert: "Emails people shortly before the closing date of scholarships they have saved.",
  // src/lib/notifications/win-back/send.ts
  win_back_email: "Sends one email to people who have been away for roughly two to three weeks, showing the new good matches that appeared while they were gone.",
  // src/lib/jobs/ingest.ts (apply_job_supersession, migration 0202)
  job_supersession: "After each job import, hides repeat postings of the same job from the same company (same title, place and text) so only the newest one shows.",
  // src/lib/notifications/inbox/enabled.ts, the notification settings page, the push routes, and the admin message functions
  notifications_master: "Turns on the notification bell, the inbox and the notification settings page; the other notification switches do nothing while this is off.",
  // src/lib/notifications/push/routes.ts, src/app/(app)/settings/notification-preferences-core.ts
  push_sender: "Allows phone push notifications to be sent and shows people the button to turn them on; the notifications master switch must be on too.",
  // src/lib/admin/messages/service.ts
  admin_messaging: "Lets staff write, approve and send messages from User messages in the admin area; with it off that page only shows a notice.",
  admin_promotions: "Lets staff send promotions as well as service announcements; with it off only announcements can be written and sent.",
  admin_email: "Lets staff use the email channel for admin messages, within the daily and monthly email limits; with it off no admin email goes out.",
  // src/lib/jobs/lifecycle.ts: only the read-only dry run exists; the waves that would act on these flags are not built
  job_lifecycle_close_imports:
    "Reserved for closing sheet-imported jobs that state no deadline seven days after import; nothing acts on it yet, so switching it on changes nothing today.",
  job_lifecycle_delete_unreferenced:
    "Reserved for deleting closed jobs that nothing refers to, keeping a short record that they existed; nothing acts on it yet, so switching it on changes nothing today.",
} as const satisfies Readonly<Record<string, string>>;

export type KnownFlagKey = keyof typeof FLAG_DESCRIPTIONS;

export const NO_DESCRIPTION_YET = "No description yet";

/** The description of a flag, or "No description yet". Own keys only, so `constructor` and `__proto__` are unknown flags, not inherited properties. */
export function describeFlag(key: string): string {
  return Object.prototype.hasOwnProperty.call(FLAG_DESCRIPTIONS, key) ? FLAG_DESCRIPTIONS[key as KnownFlagKey] : NO_DESCRIPTION_YET;
}
