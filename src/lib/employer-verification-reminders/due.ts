/**
 * Which reminder, if any, an unverified org is due for right now.
 *
 * Pure and DB-free on purpose, same reason verification.ts's own rule is:
 * the timing logic (48h, then 7d, then nothing ever again) is the part worth
 * testing without a database, and send.ts is just this function wired to a
 * real clock and real rows.
 *
 * Anchored on the EARLIEST job the org posted while unverified, not the
 * org's own `created_at` — an org could exist for a while before ever
 * posting anything, and "still unverified" only becomes a problem worth
 * emailing about once there's a real listing sitting unpublished. Fatishcakes
 * (production) matches this exactly: created 2026-08-25 11:48, posted its
 * one job 36 seconds later — for that org the two anchors are the same
 * moment, but they need not be in general.
 */
const HOUR_MS = 60 * 60 * 1000;
const REMINDER_48H_MS = 48 * HOUR_MS;
const REMINDER_7D_MS = 7 * 24 * HOUR_MS;

export type DueVerificationReminder = "48h" | "7d" | null;

export function dueVerificationReminder(args: {
  now: Date;
  earliestUnverifiedPostedAt: Date;
  reminder48hSentAt: Date | null;
  reminder7dSentAt: Date | null;
}): DueVerificationReminder {
  const elapsed = args.now.getTime() - args.earliestUnverifiedPostedAt.getTime();

  // "Then stop" — once both have gone out, this org never gets a third.
  // Checked before either threshold so a very old, already-fully-reminded
  // org (elapsed far past 7 days) doesn't re-trigger the 7d branch below.
  if (args.reminder48hSentAt && args.reminder7dSentAt) return null;

  // 7d checked before 48h: an org that's been unverified for 9 days and has
  // never been reminded at all should get the 7d email, not a stale 48h one
  // two days after it stopped being true — the 48h reminder's only value is
  // being early, and sending it late says nothing the 7d one doesn't say
  // better.
  if (elapsed >= REMINDER_7D_MS) {
    return args.reminder7dSentAt ? null : "7d";
  }
  if (elapsed >= REMINDER_48H_MS) {
    return args.reminder48hSentAt ? null : "48h";
  }
  return null;
}
