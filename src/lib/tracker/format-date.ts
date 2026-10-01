/**
 * The tracker's one date format: "28 Aug 2026" (the app's house format, src/lib/format/datetime.ts; it used to be the US
 * "Aug 28, 2026", which reads as a different date to a Nigerian reader).
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
import { formatDate } from "@/lib/format/datetime";
export function formatTrackerDate(iso: string): string {
  return formatDate(iso);
}
