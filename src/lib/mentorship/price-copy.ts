import { formatMoneyRange, isSingleAmount } from "../format-money-range";

/** What the public /mentorship page and its metadata know about price: min and max among approved, bookable, priced mentors. */
export interface MentorPriceRangeNgn {
  minNgn: number;
  maxNgn: number;
}

const PER_SESSION = "per session";

/**
 * The metadata price phrase: "₦20,000 per session" when one price is on offer, "from ₦15,000 to ₦20,000 per session" when there is a
 * spread, null when no mentor is priced. The noun appears once, supplied here and nowhere else.
 */
export function mentorshipPricePhrase(range: MentorPriceRangeNgn | null): string | null {
  return range === null ? null : formatMoneyRange(range.minNgn, range.maxNgn, "NGN", { unit: PER_SESSION });
}

/**
 * The sentence on the page that states the price, or null when no mentor is priced (the page then leaves it out entirely).
 * "Right now, a session costs ₦20,000." for one price; "Right now, sessions cost from ₦15,000 to ₦20,000." for a spread. The
 * amounts come from formatMoneyRange without a unit, so the noun is said once, here, in the verb phrase.
 */
export function mentorshipPriceSentence(range: MentorPriceRangeNgn | null): string | null {
  if (range === null) return null;
  const amounts = formatMoneyRange(range.minNgn, range.maxNgn, "NGN");
  if (amounts === null) return null;
  return isSingleAmount(range.minNgn, range.maxNgn) ? `Right now, a session costs ${amounts}.` : `Right now, sessions cost ${amounts}.`;
}

/** The metadata description's price clause, with its leading comma, or "" when there is nothing honest to say. */
export function mentorshipPriceClause(range: MentorPriceRangeNgn | null): string {
  const phrase = mentorshipPricePhrase(range);
  return phrase === null ? "" : `, ${phrase}`;
}
