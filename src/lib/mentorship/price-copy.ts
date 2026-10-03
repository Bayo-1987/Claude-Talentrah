import { formatMoneyRange } from "../format-money-range";

/** What the public /mentorship page and its metadata know about price: min and max among approved, bookable, priced mentors. */
export interface MentorPriceRangeNgn {
  minNgn: number;
  maxNgn: number;
}

const PER_SESSION = "per session";

/**
 * The price phrase for the public /mentorship page: "₦20,000 per session" when one price is on offer, "from ₦15,000 to ₦20,000
 * per session" when there is a spread, and null when no mentor is priced (callers then leave the price out entirely, never guess).
 */
export function mentorshipPricePhrase(range: MentorPriceRangeNgn | null): string | null {
  return range === null ? null : formatMoneyRange(range.minNgn, range.maxNgn, "NGN", { unit: PER_SESSION });
}

/** The metadata description's price clause, with its leading comma, or "" when there is nothing honest to say. */
export function mentorshipPriceClause(range: MentorPriceRangeNgn | null): string {
  const phrase = mentorshipPricePhrase(range);
  return phrase === null ? "" : `, ${phrase}`;
}
