/**
 * When a scholarship closes: an INSTANT, not a date (send-508, S3-21a).
 *
 * `scholarships.application_deadline` is a bare date, and "open" used to mean `>= today`, where today was the SERVER's UTC date. A
 * programme that closes "6 Oct, 13:00 Pacific" was shown open for hours after it closed. Sources do state zones; we had nowhere to put them.
 *
 * THE RULE (owner's call):
 *   zone + time known ... closes at that wall-clock time in that IANA zone
 *   zone, no time ....... closes at the END of that day in that zone (the start of the next day there)
 *   neither ............. closes at the end of the day at UTC-12, the last place on Earth to end that day, and the UI says
 *                         "time zone not stated — apply a day early"
 * Open means now < the closing instant, so AT the instant it is closed.
 *
 * THIS IS THE TWIN OF scholarship_close_instant (migration 0204). tests/scholarships/close-instant.test.ts holds the 16 inputs below to
 * the values Postgres returned for them (including daylight-saving gaps and overlaps, which Postgres resolves to the STANDARD offset),
 * and tests/scholarships/close-instant-sql.test.ts re-runs the same table against the migration in CI.
 *
 * Pure, no I/O. A row with a time but no zone is invalid in the database (a CHECK refuses it); here the time is ignored and the no-zone
 * rule applies, which is the safe reading. An unrecognised zone name also falls back to the no-zone rule rather than throwing.
 */
import { formatCalendarDate, isKnownTimeZone, timeZoneGenericName, timeZoneOffsetMs } from "@/lib/format/datetime";

export interface ScholarshipCloseFields {
  /** YYYY-MM-DD, or null when no deadline has been recorded. */
  application_deadline: string | null;
  /** HH:MM or HH:MM:SS wall-clock closing time in `close_tz`. */
  close_time: string | null;
  /** IANA zone name, e.g. "America/Vancouver". */
  close_tz: string | null;
}

const DAY_MS = 86_400_000;

function parseDate(value: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return [y, mo, d];
}

function parseTime(value: string): [number, number, number] | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = m[3] ? Number(m[3]) : 0;
  if (h > 23 || mi > 59 || s > 59) return null;
  return [h, mi, s];
}

/**
 * The UTC instant at which `tz`'s wall clock reads y-mo-d h:mi:s. Ambiguous (clocks go back) and nonexistent (clocks skip forward) wall
 * times resolve to the STANDARD offset, which is what Postgres's `timestamp AT TIME ZONE` does: of the candidate instants, the LATER one.
 */
function wallToInstantMs(tz: string, y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsets = [timeZoneOffsetMs(tz, wall - DAY_MS), timeZoneOffsetMs(tz, wall + DAY_MS)];
  const candidates = [...new Set(offsets)].map((o) => ({ at: wall - o, offset: o }));
  const valid = candidates.filter((c) => timeZoneOffsetMs(tz, c.at) === c.offset);
  const pool = valid.length > 0 ? valid : candidates;
  return Math.max(...pool.map((c) => c.at));
}

export function scholarshipCloseInstant(row: ScholarshipCloseFields): Date | null {
  if (!row.application_deadline) return null;
  const date = parseDate(row.application_deadline);
  if (!date) return null;
  const [y, mo, d] = date;
  const tz = row.close_tz && isKnownTimeZone(row.close_tz) ? row.close_tz : null;

  if (tz && row.close_time) {
    const time = parseTime(row.close_time);
    if (time) return new Date(wallToInstantMs(tz, y, mo, d, time[0], time[1], time[2]));
  }
  if (tz) {
    // A zone but no (usable) time: the end of that day there is the start of the next.
    return new Date(wallToInstantMs(tz, y, mo, d + 1, 0, 0, 0));
  }
  // No zone: the end of the day at UTC-12, i.e. 12:00 UTC the next day.
  return new Date(Date.UTC(y, mo - 1, d + 1, 12, 0, 0));
}

/** Open means strictly before the closing instant. No deadline recorded means open (as it always did). */
export function isScholarshipOpen(row: ScholarshipCloseFields, now: Date = new Date()): boolean {
  const instant = scholarshipCloseInstant(row);
  return instant === null || now.getTime() < instant.getTime();
}

/**
 * Whole days left: null with no deadline, 0 in the last 24 hours (the page says "closes today"), and negative once closed
 * (-1 or lower; never 0 at or after the instant).
 */
export function scholarshipDaysLeft(row: ScholarshipCloseFields, now: Date = new Date()): number | null {
  const instant = scholarshipCloseInstant(row);
  if (instant === null) return null;
  const ms = instant.getTime() - now.getTime();
  if (ms <= 0) return Math.min(-1, Math.floor(ms / DAY_MS));
  return Math.floor(ms / DAY_MS);
}

/** What a reader is told about the closing time; null when no deadline has been recorded. */
export function scholarshipCloseText(row: ScholarshipCloseFields): string | null {
  if (!row.application_deadline) return null;
  const date = formatCalendarDate(row.application_deadline);
  if (!date) return null;
  const instant = scholarshipCloseInstant(row);
  const tz = row.close_tz && isKnownTimeZone(row.close_tz) ? row.close_tz : null;
  if (!tz || !instant) return `Closes ${date} — time zone not stated, apply a day early`;
  const label = timeZoneGenericName(tz, instant);
  const time = row.close_time ? parseTime(row.close_time) : null;
  if (time) {
    const hh = String(time[0]).padStart(2, "0");
    const mm = String(time[1]).padStart(2, "0");
    return `Closes ${date}, ${hh}:${mm} (${label})`;
  }
  return `Closes ${date}, end of day (${label})`;
}

/**
 * The PostgREST `or` filter for "still open at `now`", for queries that cannot call scholarship_is_open: it reads the `close_at` column the
 * database keeps equal to scholarship_close_instant (migration 0204). A row with no deadline has no close_at and is open.
 */
export function openScholarshipFilter(now: Date = new Date()): string {
  return `close_at.is.null,close_at.gt.${now.toISOString()}`;
}

/** The minimal query-builder surface the list page's window needs (Supabase's builder satisfies it). */
interface RangeFilterable<Q> {
  not: (column: string, operator: string, value: null) => Q;
  gt: (column: string, value: string) => Q;
  lte: (column: string, value: string) => Q;
}

/**
 * "Closing within N days": the closing INSTANT is ahead of `now` and no more than N days after it. (The list page used to compare the
 * deadline DATE between today and today + N in UTC.) Rows with no deadline have no close_at and never match, as before.
 */
export function applyClosingWithin<Q extends RangeFilterable<Q>>(query: Q, days: number, now: Date = new Date()): Q {
  const horizon = new Date(now.getTime() + days * DAY_MS);
  return query.not("close_at", "is", null).gt("close_at", now.toISOString()).lte("close_at", horizon.toISOString());
}

/**
 * Of a person's saved scholarships, those still open that close within `days` whole days: the in-app "closing soon" reminder.
 * Sorted soonest first. The days-left figure is `scholarshipDaysLeft`, so it reads to the instant, not to the calendar date.
 */
export function dueSoonScholarships<T extends ScholarshipCloseFields>(rows: readonly T[], days: number, now: Date = new Date()): Array<T & { left: number }> {
  return rows
    .map((r) => ({ ...r, left: scholarshipDaysLeft(r, now) }))
    .filter((r): r is T & { left: number } => r.left !== null && r.left >= 0 && r.left <= days)
    .sort((a, b) => a.left - b.left);
}
