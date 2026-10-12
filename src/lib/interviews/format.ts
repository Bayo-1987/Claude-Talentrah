import { formatTime, formatWeekdayAtTime, formatWeekdayAtTimeZoned, isKnownTimeZone } from "@/lib/format/datetime";

/**
 * Interview times are stored in UTC and SHOWN in the viewer's own time zone, never the server's. These take the zone as an argument (the page passes the browser's, or a fallback), so the
 * same instant reads right in Lagos (UTC+1 all year) and in London (BST until the clocks go back on Sunday 25 October 2026, GMT after). An unknown zone falls back to UTC rather than throwing.
 */
function safeZone(timeZone: string): string {
  return timeZone && isKnownTimeZone(timeZone) ? timeZone : "UTC";
}

/** "Mon 26 Oct at 10:00 WAT": the weekday, day, month and 24-hour time in the zone, with the zone's own name at that instant (BST before 25 Oct 2026, GMT after, in London). */
export function formatInterviewTime(startsAtIso: string, timeZone: string): string {
  return formatWeekdayAtTimeZoned(startsAtIso, { timeZone: safeZone(timeZone) });
}

/** "Mon 26 Oct at 10:00 to 10:45 WAT": the start with its day, then the end time, in one zone. */
export function formatInterviewRange(startsAtIso: string, durationMinutes: number, timeZone: string): string {
  const zone = safeZone(timeZone);
  const end = new Date(new Date(startsAtIso).getTime() + durationMinutes * 60_000);
  return `${formatWeekdayAtTime(startsAtIso, { timeZone: zone })} to ${formatTime(end, { timeZone: zone })}`.trim();
}
