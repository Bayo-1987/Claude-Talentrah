/**
 * The app's ONE date and time formatter (send-499).
 *
 * Why it exists. About sixty call sites each formatted a date their own way: Get Verified history "9/10/2026" (a Nigerian
 * reads that as 9 October, a future date), mentorship sessions "9/17/2026, 10:00:00 AM" (seconds, no zone), the tracker in
 * US order, blog cards "SEPTEMBER 20, 2026" beside "Sep 21, 2026" and "2 Oct 2026". `toLocale*String()` with no locale also
 * resolves against whatever the runtime defaults to, so the same code printed different text on the server and in the
 * browser. tests/format/no-direct-locale-formatting.test.ts now fails on any direct use outside this file.
 *
 * Founder rules:
 *   dates  "10 Sep 2026": day, short month, year; never all-numeric.
 *   times  "10:00 WAT": 24-hour, never seconds; in the viewer's zone when known, otherwise WAT (Africa/Lagos).
 *   relative times ("3 days ago") stay in src/lib/format-relative-time.ts.
 *
 * The month names are written out here, not asked of Intl: ICU spells September "Sept" in en-GB and "Sep" in en-US, so
 * asking the runtime would make the output depend on the Node build. Intl is used only for what it is good at, the
 * calendar parts of an instant in a named zone.
 *
 * Two kinds of input, deliberately different:
 *   - an INSTANT (a Date, an ISO timestamp, epoch milliseconds) is read in a zone: the same instant is a different
 *     calendar day in Lagos and in Los Angeles;
 *   - a CALENDAR DATE (a bare "YYYY-MM-DD": a deadline day, a birthday) has no zone and is never shifted. Parsing it with
 *     `new Date("2026-10-02")` reads it as UTC midnight, which is 1 October west of Greenwich; that is the bug this avoids.
 */

/** WAT. Used whenever the viewer's zone is not known, and when a zone name cannot be used. */
export const DEFAULT_TIME_ZONE = "Africa/Lagos";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** What a person in the zone calls it. Intl would answer "GMT+1" for most of these in en-US. */
const ZONE_LABELS: Record<string, string> = {
  "Africa/Lagos": "WAT",
  "Africa/Kinshasa": "WAT",
  "Africa/Luanda": "WAT",
  "Africa/Douala": "WAT",
  "Africa/Accra": "GMT",
  "Africa/Abidjan": "GMT",
  "Africa/Dakar": "GMT",
  "Africa/Nairobi": "EAT",
  "Africa/Addis_Ababa": "EAT",
  "Africa/Kampala": "EAT",
  "Africa/Dar_es_Salaam": "EAT",
  "Africa/Harare": "CAT",
  "Africa/Lusaka": "CAT",
  "Africa/Maputo": "CAT",
  "Africa/Johannesburg": "SAST",
  UTC: "UTC",
  "Etc/UTC": "UTC",
};

export type DateInput = Date | string | number | null | undefined;
export interface FormatOptions {
  /** An IANA zone name ("America/Toronto"). Absent or unusable means WAT. */
  timeZone?: string;
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toInstant(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const zoneCache = new Map<string, boolean>();
/** The zone if Intl accepts it, else WAT: a bad name from a profile must degrade, not throw in the middle of a page. */
function usableZone(timeZone: string | undefined): string {
  if (!timeZone) return DEFAULT_TIME_ZONE;
  let ok = zoneCache.get(timeZone);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
      ok = true;
    } catch {
      ok = false;
    }
    zoneCache.set(timeZone, ok);
  }
  return ok ? timeZone : DEFAULT_TIME_ZONE;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function calendarParts(date: Date, timeZone: string) {
  let fmt = partsFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    partsFormatters.set(timeZone, fmt);
  }
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: p.hour, minute: p.minute };
}

/** "WAT", "UTC", "EDT"... The label for a zone at an instant (daylight saving changes it). */
function zoneLabel(timeZone: string, date: Date): string {
  const known = ZONE_LABELS[timeZone];
  if (known) return known;
  const locale = timeZone.startsWith("Europe/") ? "en-GB" : "en-US";
  const name = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" }).formatToParts(date).find((p) => p.type === "timeZoneName");
  return name?.value ?? timeZone;
}

/** A real calendar day written "YYYY-MM-DD", as "2 Oct 2026". Anything else, including a timestamp or Feb 30, is "". */
export function formatCalendarDate(ymd: string): string {
  const m = CALENDAR_DATE.exec(ymd);
  if (!m) return "";
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return "";
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** An instant as a date in a zone: "10 Sep 2026". A bare "YYYY-MM-DD" is a calendar date and is not shifted. */
export function formatDate(value: DateInput, options: FormatOptions = {}): string {
  if (typeof value === "string" && CALENDAR_DATE.test(value)) return formatCalendarDate(value);
  const date = toInstant(value);
  if (!date) return "";
  const { year, month, day } = calendarParts(date, usableZone(options.timeZone));
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** An instant as a 24-hour time with its zone: "10:00 WAT". Never seconds. A calendar date has no time, so it is "". */
export function formatTime(value: DateInput, options: FormatOptions = {}): string {
  if (typeof value === "string" && CALENDAR_DATE.test(value)) return "";
  const date = toInstant(value);
  if (!date) return "";
  const timeZone = usableZone(options.timeZone);
  const { hour, minute } = calendarParts(date, timeZone);
  return `${hour}:${minute} ${zoneLabel(timeZone, date)}`;
}

/** "17 Sep 2026, 10:00 WAT": the date and the time from the SAME zone. A calendar date gives just the date. */
export function formatDateTime(value: DateInput, options: FormatOptions = {}): string {
  if (typeof value === "string" && CALENDAR_DATE.test(value)) return formatCalendarDate(value);
  const date = formatDate(value, options);
  if (!date) return "";
  return `${date}, ${formatTime(value, options)}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * An instant as "Fri 9 Oct at 14:20": the weekday, day, short month and 24-hour time in a zone. No year, never seconds, and no zone label:
 * it is for text that says when something happens in the viewer's own zone (Farah's "next free message"), where WAT or GMT+1 would add nothing.
 * The weekday comes from the zone's own calendar day, not from the instant's UTC day. A calendar date has no time, so it is "".
 */
export function formatWeekdayAtTime(value: DateInput, options: FormatOptions = {}): string {
  if (typeof value === "string" && CALENDAR_DATE.test(value)) return "";
  const date = toInstant(value);
  if (!date) return "";
  const { year, month, day, hour, minute } = calendarParts(date, usableZone(options.timeZone));
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${day} ${MONTHS[month - 1]} at ${hour}:${minute}`;
}

/** The viewer's own IANA zone name, or undefined when the runtime will not say. Read on the client; pass it to the formatters' `timeZone`. */
export function viewerTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Time-zone arithmetic for src/lib/scholarships/close-instant.ts (send-508). Kept HERE because this module is the one place Intl is
 * allowed (tests/format/no-direct-locale-formatting.test.ts): these read a zone's rules, they do not format a value for display.
 */

/** Whether `timeZone` is a zone name the runtime recognises. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The zone's UTC offset, in milliseconds, in force at the instant `t` (milliseconds since the epoch). */
export function timeZoneOffsetMs(timeZone: string, t: number): number {
  const floored = Math.floor(t / 1000) * 1000;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(floored));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const hour = n("hour") === 24 ? 0 : n("hour");
  return Date.UTC(n("year"), n("month") - 1, n("day"), hour, n("minute"), n("second")) - floored;
}

/** Zone ids that ARE Coordinated Universal Time. Intl names them "GMT+00:00", which reads as an offset rather than the zone a source stated. */
const UTC_ZONE_IDS: ReadonlySet<string> = new Set([
  "UTC", "Etc/UTC", "Etc/UCT", "UCT", "Etc/Universal", "Universal", "Etc/Zulu", "Zulu",
  "Etc/GMT", "GMT", "Etc/Greenwich", "Greenwich", "Etc/GMT0", "GMT0", "Etc/GMT+0", "Etc/GMT-0",
]);

/** A zone's generic long name at an instant, in the house's lower-case "time": "Pacific time", "Central European time". UTC is "UTC". Falls back to the zone id. */
export function timeZoneGenericName(timeZone: string, at: Date): string {
  if (UTC_ZONE_IDS.has(timeZone)) return "UTC";
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longGeneric" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    return part ? part.replace(/\bTime\b/, "time") : timeZone;
  } catch {
    return timeZone;
  }
}
