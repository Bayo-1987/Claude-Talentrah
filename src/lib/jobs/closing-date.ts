/**
 * When a card or job page may say "Closes <date>", how it reads, and when it also says "Closing soon" (JOBS-POLISH-1, P5).
 *
 * ONLY A STATED DATE IS SHOWN. `job_postings.expires_at_source` (0278) is 'stated' when an employer, a sheet deadline or a source's own validThrough gave the date, and 'default' when we applied the
 * 30-day lifetime because nobody did. A date we invented must not be shown as if someone chose it, and NULL means unknown (a row from before the column that the backfill could not place): unknown
 * shows nothing, the same as 'default'. This is a display rule only. What closes a posting, and when, is src/lib/jobs/expiry.ts and is not touched.
 *
 * DATES ARE AFRICA/LAGOS DAYS. Nigeria is UTC+1 all year, so a deadline of 23:00Z is already the next day there, and the sheet importer stores the END of the stated day as 22:59:59Z. The calendar day is
 * read in Lagos, and "7 days or fewer" counts Lagos calendar days (today included), not 24-hour spans.
 *
 * Pure: the clock is a parameter.
 */
import { formatDate, timeZoneOffsetMs } from "@/lib/format/datetime";

export const CLOSING_SOON_DAYS = 7;
const LAGOS = "Africa/Lagos";

export interface ClosingFacts {
  expires_at?: string | null;
  expires_at_source?: string | null;
}

/** The closing instant, only where it was stated and can be read. */
export function statedClosesAt(job: ClosingFacts): Date | null {
  if (job.expires_at_source !== "stated" || !job.expires_at) return null;
  const at = new Date(job.expires_at);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** The Lagos calendar day of an instant, as a whole number of days since the epoch (so two of them subtract to a day count). Built on the formatter's zone rules, not on a formatter of its own. */
function lagosDayNumber(at: Date): number {
  return Math.floor((at.getTime() + timeZoneOffsetMs(LAGOS, at.getTime())) / 86_400_000);
}

export interface ClosingNotice {
  /** "Closes 10 Nov 2026" */
  label: string;
  /** 7 Lagos days or fewer to go, today included. */
  soon: boolean;
}

/** What to show for a posting's closing date, or null for nothing (not stated, unreadable, or already past). */
export function closingNotice(job: ClosingFacts, now: Date = new Date()): ClosingNotice | null {
  const at = statedClosesAt(job);
  if (!at) return null;
  const daysLeft = lagosDayNumber(at) - lagosDayNumber(now);
  if (daysLeft < 0) return null;
  // The date itself is the app's one formatter's ("10 Nov 2026": day, short month, year; the month names are written out there, not asked of Intl).
  return { label: `Closes ${formatDate(at, { timeZone: LAGOS })}`, soon: daysLeft <= CLOSING_SOON_DAYS };
}
