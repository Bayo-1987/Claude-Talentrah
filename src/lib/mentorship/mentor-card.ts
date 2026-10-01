/**
 * The mentor list card's price line (send-497, S15).
 *
 * The card said "From ₦20,000 / session" while the mentor's own profile said "No open slots right now": the card read the
 * price off the mentor row and never looked at slots. With nothing to book there is no price worth quoting, so the card
 * says what the profile says. The words are the profile page's own (tests/mentorship/mentor-card.test.ts reads that
 * page's source to keep them equal).
 */

export const NO_OPEN_SLOTS = "No open slots right now";

export function mentorCardPriceLine(mentor: { basePriceNgn: number | null; openSlotCount: number }): string {
  if (mentor.openSlotCount <= 0) return NO_OPEN_SLOTS;
  return mentor.basePriceNgn != null ? `From ₦${mentor.basePriceNgn.toLocaleString()} / session` : "Free / volunteer";
}

/** One count per mentor from a flat list of open-slot rows (one row per slot). */
export function countOpenSlotsByMentor(rows: ReadonlyArray<{ mentor_id: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.mentor_id, (counts.get(r.mentor_id) ?? 0) + 1);
  return counts;
}
