/**
 * How long an unpaid mentor booking holds its slot (send-502, S15).
 *
 * A booking is created `pending_payment` BEFORE payment (0133), which locks the slot. Left alone, a mentee who never pays
 * keeps that slot hostage until it starts. So an unpaid booking holds its slot for UNPAID_HOLD_MINUTES, and after that the
 * slot counts as open again.
 *
 * The rule cannot depend on the daily sweep (Vercel Hobby crons cannot run more often), so it is enforced where it is read
 * and where it is booked, in SQL (migration 0203: `mentor_unpaid_hold()`, `open_mentor_slots`, `book_mentor_session`). This is
 * the TypeScript half, for the mentee's own page. The two numbers are pinned to each other by tests/mentorship/unpaid-hold.test.ts.
 */

export const UNPAID_HOLD_MINUTES = 30;
const UNPAID_HOLD_MS = UNPAID_HOLD_MINUTES * 60_000;

/** Shown to the mentee on a booking they can still pay for. */
export const UNPAID_HOLD_NOTICE = `Complete payment within ${UNPAID_HOLD_MINUTES} minutes to keep this slot`;

export function unpaidHoldEndsAt(createdAt: string): Date {
  return new Date(Date.parse(createdAt) + UNPAID_HOLD_MS);
}

/**
 * True once the hold has run out. At exactly 30:00 it has: the SQL says `created_at <= now() - hold`, and the two must agree
 * on the boundary. An unknown or unparseable createdAt is never treated as lapsed: this is a display rule, and the server
 * (not this function) is what actually releases the slot.
 */
export function unpaidHoldLapsed(createdAt: string | undefined, now: Date): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  return now.getTime() - created >= UNPAID_HOLD_MS;
}
