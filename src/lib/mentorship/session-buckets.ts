/**
 * Which section of the mentee's sessions page a session belongs in (send-497, S15).
 *
 * The page used to put everything that was not completed, cancelled or refunded under "Upcoming", so an unpaid booking
 * whose slot started two weeks ago sat there as "Upcoming · Awaiting payment" with nothing to do about it. Owner's call:
 * Upcoming shows only paid or confirmed sessions that have not ended; an unpaid booking that can still be paid has its
 * own section; an unpaid booking whose slot has started is past (it expires when the slot starts: the same rule the
 * sweep will enforce for real, and release the slot, in the migration PR that follows).
 *
 * Pure, so the rule is tested at the exact boundary minute without rendering the page.
 */

export type SessionBucket = "upcoming" | "awaiting_payment" | "past";

/** Paid for and not finished: waiting on the mentor, or confirmed. */
const PAID_AND_LIVE = new Set(["awaiting_confirmation", "confirmed"]);

export function bucketSession(
  session: { status: string; scheduledStart: string; scheduledEnd: string },
  now: Date,
): SessionBucket {
  const t = now.getTime();
  // Unpaid: payable only until the slot starts. At the start instant it is past.
  if (session.status === "pending_payment") return Date.parse(session.scheduledStart) > t ? "awaiting_payment" : "past";
  // Paid: still upcoming while it has not ended, so a session in progress keeps its meeting link.
  if (PAID_AND_LIVE.has(session.status)) return Date.parse(session.scheduledEnd) > t ? "upcoming" : "past";
  // completed, cancelled, refunded, and any status this build does not know: never promoted to Upcoming.
  return "past";
}

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment",
  awaiting_confirmation: "Waiting on the mentor to confirm",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled_mentor_no_confirm: "Cancelled — mentor didn't confirm in time",
  refunded: "Refunded",
};

/** The status line for a session. An unpaid booking whose slot has started says it expired rather than "Awaiting payment". */
export function sessionStatusLabel(status: string, scheduledStart: string, now: Date): string {
  if (status === "pending_payment" && !(Date.parse(scheduledStart) > now.getTime())) return "Expired — not paid";
  return STATUS_LABEL[status] ?? status;
}
