import { PROMOTED_LABEL } from "./promoted-label";
import { TALENT_DIRECTORY_BOOST_DAYS } from "./boost-constants";

/**
 * What a seeker is told a boost buys (V5, migration 0268). A boost does NOT put anyone first: it gives a rotating seat in the Promoted strip, a labelled row of at most three boosted candidates on the first
 * page of an employer's search, fixed for one UTC hour and moving every hour. So the copy says a seat, says it rotates, and never promises a position. Client-safe (the boost panel is a client component).
 * The word is the label's own constant. tests/talent-directory/boost-copy.test.tsx pins the exact wording, forbids a top-of-search promise, and pins the two numbers below to the migration.
 */

/** How many candidates the strip holds at most: 0268's helper caps it at 3 whatever is asked (talent_directory_promoted_ids). */
export const PROMOTED_STRIP_SEATS = 3;

/** The thing a boost buys, as a phrase. */
export const BOOST_SEAT = `a rotating seat in the ${PROMOTED_LABEL} strip`;

/**
 * The one sentence that tells a seeker the label exists. It says "your entry in employer search" and "whenever it appears in the strip": the label is drawn on the search list's row when the
 * database has put that row in the strip, not on the candidate's own page and not in every search. The word is the label's own constant.
 */
export const BOOST_LABEL_DISCLOSURE = `While a boost is active, your entry in employer search shows a "${PROMOTED_LABEL}" label whenever it appears in the strip.`;

/** The paragraph above the Boost button. */
export function boostPanelIntro(credits: number): string {
  return (
    `A boost gives you ${BOOST_SEAT} on employer search for ${TALENT_DIRECTORY_BOOST_DAYS} days — ${credits} credits. ` +
    `The strip shows up to ${PROMOTED_STRIP_SEATS} boosted candidates at a time and rotates every hour, so a seat is not a fixed position. ` +
    `${BOOST_LABEL_DISCLOSURE} ` +
    `Purchases stack: buying again while already boosted adds ${TALENT_DIRECTORY_BOOST_DAYS} more days to your current boost.`
  );
}

/** The message after a successful purchase. `until` is the already-formatted end date. */
export function boostPurchasedMessage(until: string): string {
  return `Boost added: ${BOOST_SEAT} for ${TALENT_DIRECTORY_BOOST_DAYS} days, now until ${until}.`;
}
