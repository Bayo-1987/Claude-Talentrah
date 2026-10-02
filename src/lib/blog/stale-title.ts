/**
 * Flag a post title that carries a date that has passed (send-509, S3-21c).
 *
 * Two published posts went stale within days of going out: "...First Deadline Is 2 October 2026" and "...The Deadline Is 6 October 2026".
 * The owner's rule is no hard dates in the titles of content that outlives the date; this is the check that notices when one slips in, shown
 * on /admin/blog. It FLAGS, it never blocks.
 *
 * What counts as a date: day + month + year ("2 October 2026", "2nd Oct, 2026", "October 2, 2026"), ISO ("2026-10-02"), day + month with no
 * year ("6 Oct", "October 6"), and a month + year ("October 2026"). What does not: a bare year ("Chevening 2027", "Class of 2027-2028"), a
 * number ("Top 10", "Phase 2 of 3"), a month name used as a word ("May I apply?"), or an impossible day (30 February).
 *
 * "Passed" is judged in UTC: a day is over once the next day has begun, so on 2 October a title naming 2 October is not yet stale; a
 * month + year is over when the month is. A date with NO year is judged against the CURRENT year only, since a title cannot say which
 * October it meant, which is exactly why the rule is "no hard dates" and not "dates are fine until they pass".
 */

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4, june: 5, jun: 5,
  july: 6, jul: 6, august: 7, aug: 7, september: 8, sept: 8, sep: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
};
const MONTH = "(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)";
const DAY = "(\\d{1,2})(?:st|nd|rd|th)?";

interface Hit {
  text: string;
  start: number;
  end: number;
  /** The first instant (UTC ms) at which this date counts as passed. */
  passedAt: number | null;
}

function validDay(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m && t.getUTCDate() === d;
}

const dayEnd = (y: number, m: number, d: number) => Date.UTC(y, m, d + 1);

export function staleDatesInTitle(title: string, now: Date = new Date()): string[] {
  if (!title) return [];
  const nowMs = now.getTime();
  const thisYear = now.getUTCFullYear();
  const hits: Hit[] = [];
  const taken = (s: number, e: number) => hits.some((h) => s < h.end && e > h.start);

  const add = (m: RegExpExecArray, passedAt: number | null) => {
    const start = m.index;
    const end = start + m[0].length;
    if (taken(start, end)) return;
    // An invalid date (30 February) is still RECORDED, with no passing time: it consumes its characters so a looser pattern cannot
    // re-read "February 2026" out of it, and it is filtered out of the result below.
    hits.push({ text: m[0], start, end, passedAt });
  };

  // Most specific first, so "2 Oct 2026" is one date and not "2 Oct" plus a stray year.
  for (const m of title.matchAll(new RegExp(`\\b${DAY}\\s+${MONTH}\\.?,?\\s+(\\d{4})\\b`, "gi"))) {
    const d = Number(m[1]), mo = MONTHS[m[2].toLowerCase()], y = Number(m[3]);
    add(m as RegExpExecArray, validDay(y, mo, d) ? dayEnd(y, mo, d) : null);
  }
  for (const m of title.matchAll(new RegExp(`\\b${MONTH}\\.?\\s+${DAY},?\\s+(\\d{4})\\b`, "gi"))) {
    const mo = MONTHS[m[1].toLowerCase()], d = Number(m[2]), y = Number(m[3]);
    add(m as RegExpExecArray, validDay(y, mo, d) ? dayEnd(y, mo, d) : null);
  }
  for (const m of title.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
    add(m as RegExpExecArray, validDay(y, mo, d) ? dayEnd(y, mo, d) : null);
  }
  // Day and month, no year: the current year.
  for (const m of title.matchAll(new RegExp(`\\b${DAY}\\s+${MONTH}\\b`, "gi"))) {
    const d = Number(m[1]), mo = MONTHS[m[2].toLowerCase()];
    add(m as RegExpExecArray, validDay(thisYear, mo, d) ? dayEnd(thisYear, mo, d) : null);
  }
  for (const m of title.matchAll(new RegExp(`\\b${MONTH}\\.?\\s+${DAY}\\b(?!\\s*,?\\s*\\d{4})`, "gi"))) {
    const mo = MONTHS[m[1].toLowerCase()], d = Number(m[2]);
    add(m as RegExpExecArray, validDay(thisYear, mo, d) ? dayEnd(thisYear, mo, d) : null);
  }
  // A month and a year: over once the month is.
  for (const m of title.matchAll(new RegExp(`\\b${MONTH}\\.?,?\\s+(\\d{4})\\b`, "gi"))) {
    const mo = MONTHS[m[1].toLowerCase()], y = Number(m[2]);
    add(m as RegExpExecArray, Date.UTC(y, mo + 1, 1));
  }

  return hits
    .filter((h) => h.passedAt !== null && nowMs >= h.passedAt)
    .sort((a, b) => a.start - b.start)
    .map((h) => h.text.trim());
}
