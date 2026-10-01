/**
 * Which section of the mentee's sessions page a session belongs in (send-497, S15).
 *
 * The page used to put everything that was not completed, cancelled or refunded under "Upcoming", so an unpaid booking
 * whose slot started two weeks ago sat there as "Upcoming · Awaiting payment" with nothing to do about it. Owner's call:
 * Upcoming shows only paid or confirmed sessions that have not ended; an unpaid booking that can still be paid has its
 * own section; an unpaid booking whose slot has started is past. Until the sweep has run that is a DISPLAY rule only (the row
 * is still `pending_payment` and its slot still held), so such a row says "Not paid — the slot has passed", never "expired".
 * Once migration 0203's sweep has expired it, the row is `expired_unpaid` with its slot released, and says "Expired — not paid".
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

const MENTEE_LABELS: Record<string, string> = {
  pending_payment: "Awaiting payment",
  awaiting_confirmation: "Waiting on the mentor to confirm",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled_mentor_no_confirm: "Cancelled — mentor didn't confirm in time",
  refunded: "Refunded",
  // 0203: real statuses now, set by the sweep, the mentee's own Cancel, and fulfilment of a payment that arrived too late.
  expired_unpaid: "Expired — not paid",
  cancelled_by_mentee: "Cancelled by you",
  payment_needs_refund: "Payment received — refund being arranged",
};

const MENTOR_LABELS: Record<string, string> = {
  pending_payment: "Awaiting the mentee's payment",
  awaiting_confirmation: "Awaiting your confirmation",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled_mentor_no_confirm: "Auto-cancelled — you didn't confirm in time",
  refunded: "Refunded",
  expired_unpaid: "Expired — not paid",
  cancelled_by_mentee: "Cancelled by the mentee",
  // The mentor is told that this booking will not happen, not what happened to the money.
  payment_needs_refund: "Cancelled — the payment arrived too late",
};

/**
 * The status line for a session, worded for the mentee (default) or the mentor. An unpaid booking whose slot has started
 * says what is true and no more: it was not paid and the slot has passed. It does not say "expired" (nothing has expired
 * yet) or that the slot was released (it has not been).
 */
export function sessionStatusLabel(status: string, scheduledStart: string, now: Date, side: "mentee" | "mentor" = "mentee"): string {
  if (status === "pending_payment" && !(Date.parse(scheduledStart) > now.getTime())) return "Not paid — the slot has passed";
  return (side === "mentor" ? MENTOR_LABELS : MENTEE_LABELS)[status] ?? status;
}
