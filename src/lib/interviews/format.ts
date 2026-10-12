/**
 * Interview times are stored in UTC and SHOWN in the viewer's own time zone, never the server's. These take the zone as an argument (the page passes the browser's, or a fallback), so the
 * same instant reads right in Lagos (UTC+1 all year) and in London (BST until the clocks go back on Sunday 25 October 2026, GMT after). An unknown zone falls back to UTC rather than throwing.
 */
function safeZone(timeZone: string): string {
  try {
    if (!timeZone) return "UTC";
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

export function formatInterviewTime(startsAtIso: string, timeZone: string): string {
  const zone = safeZone(timeZone);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: zone,
    timeZoneName: "short",
  }).format(new Date(startsAtIso));
}

/** "Mon, 26 Oct 2026, 10:00 to 10:45 GMT+1": the start with its date, then the end time, in one zone. */
export function formatInterviewRange(startsAtIso: string, durationMinutes: number, timeZone: string): string {
  const zone = safeZone(timeZone);
  const start = new Date(startsAtIso);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const clock = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(d);
  const dateOnly = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: zone }).format(start);
  const zoneName = new Intl.DateTimeFormat("en-GB", { timeZoneName: "short", timeZone: zone }).formatToParts(start).find((p) => p.type === "timeZoneName")?.value ?? "";
  return `${dateOnly}, ${clock(start)} to ${clock(end)} ${zoneName}`.trim();
}
