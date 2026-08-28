/**
 * The tracker's one date format: "Aug 28, 2026".
 *
 * Lifted out of tracker-card.tsx rather than exported from it. The card is a
 * server component and NotesForm is now a client one, so importing the helper
 * from the card would pull the card — and everything it imports — into the
 * client bundle to reuse six lines.
 *
 * There is one format here on purpose. "Applied Aug 27, 2026" and
 * "Edited Aug 28, 2026" sit two lines apart on the same card, and a second
 * formatter is how they end up disagreeing about whether the year is shown.
 */
export function formatTrackerDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
