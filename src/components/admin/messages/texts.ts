import type { AdminMessageKind, AdminMessageStatus } from "@/lib/notifications/contract";

/**
 * The sentences the admin messaging screens say in plain words. They live in one file so a component test can pin each one, and so the page, the action results and the help text
 * cannot drift apart.
 */

/** Fix 3: shown on the Prepare screen next to the push channel, and in the help text. There is no option anywhere that bypasses it. */
export const QUIET_HOURS_SENTENCE =
  "A push to a person during their quiet hours (22:00 to 07:00 in the time zone of their device) is suppressed and is not retried later. The same message still reaches that person in the app and by email. There is no urgent override.";

export const SWITCHED_OFF_NOTICE = "Admin messaging is switched off. Nothing can be written, approved or sent from this page until it is switched on in Feature flags.";

export function switchedOffReason(what: "messaging" | "promotions" | "email"): string {
  if (what === "promotions") return "Promotions are switched off, so a promotion cannot be written, prepared or sent.";
  if (what === "email") return "Admin email is switched off, so the email channel cannot be used.";
  return SWITCHED_OFF_NOTICE;
}

export const KIND_LABEL: Record<AdminMessageKind, string> = {
  service_announcement: "Service announcement",
  promotion: "Promotion",
};

export const KIND_EXPLAINER: Record<AdminMessageKind, string> = {
  service_announcement: "Something people need to know about the service. It goes to the announcements stream, which they can switch off.",
  promotion: "Marketing. It goes only to people who opted in to promotions, carries a consent line, and always needs a second person to approve it.",
};

export const STATUS_LABEL: Record<AdminMessageStatus, string> = {
  draft: "Draft",
  prepared: "Prepared",
  submitted: "Waiting for approval",
  approved: "Approved",
  sending: "Sending",
  sent: "Sent",
  cancelled: "Cancelled",
  paused_email_cap: "Paused: daily email cap",
  paused_email_ceiling: "Paused: monthly email ceiling",
};

/** What a paused message says, in the words the owner chose. Null for a message that is not paused. */
export function pausedSentence(status: AdminMessageStatus, limits: { cap24h: number; ceilingMonth: number }): string | null {
  if (status === "paused_email_cap") return `Mass email is paused: the 24-hour cap of ${limits.cap24h} has been reached. The people not yet sent to are still queued, and nothing is sent until someone resumes it.`;
  if (status === "paused_email_ceiling") return `Mass email is paused: this month's ceiling of ${limits.ceilingMonth} has been reached. The people not yet sent to are still queued, and nothing is sent until someone resumes it.`;
  return null;
}

export const RAISING_A_LIMIT_NOTE = "Raising a limit does not resume a paused message. Resuming is a separate step, taken on the message itself.";

export const COUNTS_ONLY_NOTE = "This page shows counts only. It never lists the people a message goes to.";

export const STALE_CLAIM_EXPLAINER =
  "An email whose result is unknown stays open: the system never sends to that person again on its own, and never releases it on its own. After 30 minutes a person decides: mark it sent if you know it went out, or release it so a later run may try again.";

/** One line each under Kind on the compose screen. */
export const KIND_HELP: Record<AdminMessageKind, string> = {
  service_announcement: "Service announcement: a notice about the service itself (changes, outages, policy, security). People receive it by default.",
  promotion: "Promotion: anything that encourages use or offers something (offers, new-jobs news). Each person can turn it off, it is off by default, and it needs a consent line.",
};

/** Under the consent line. The samples are hint text only: nothing is prefilled. */
export const CONSENT_LINE_HELP = "Why this person is receiving it. It must be true for everyone in the audience.";
export const CONSENT_LINE_SAMPLES = [
  "You turned on offers and promotions in your Talentrah notification settings.",
  "You signed up to Talentrah and agreed to receive offers and updates.",
  "You asked us to tell you about new jobs in Nigeria.",
] as const;
