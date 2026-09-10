/**
 * RFC 5545 (.ics) calendar invite generation, plus a Google Calendar
 * "add to calendar" link — the calendar-invite half of the lighter fix for
 * §6.11's cut video-call integration (see 0138's own migration header for the
 * full reasoning on why this stays Jitsi-based rather than a Google Meet
 * OAuth integration).
 *
 * Pure and side-effect free on purpose: no DB, no network, no server-only
 * import. Everything here is unit-testable without a database, and
 * src/lib/notifications/mentorship/send.ts is the only caller.
 */

export interface CalendarInviteAttendee {
  name: string;
  email: string;
}

export interface CalendarInviteInput {
  /** `mentorship_sessions.id` — the stable identity a UID is built from, so
   * re-sending an invite for the SAME session (e.g. a reminder) produces the
   * same UID and a calendar client updates the existing entry rather than
   * creating a duplicate. */
  sessionId: string;
  summary: string;
  description: string;
  /** The Jitsi meeting link — used as both LOCATION and inside DESCRIPTION,
   * since a calendar client's own "join" affordance reads LOCATION for a
   * virtual event. */
  meetingLink: string;
  scheduledStart: string | Date;
  scheduledEnd: string | Date;
  organizer: CalendarInviteAttendee;
  attendees: CalendarInviteAttendee[];
  /** Bumped only if a session's OWN details (time, link) ever change after
   * the first invite goes out — v1 has no such path (confirmation sets
   * scheduled_start/end and meeting_link exactly once), so every caller
   * passes 0. Kept as a parameter rather than hardcoded so that invariant is
   * asserted at the call site, not assumed silently in here. */
  sequence?: number;
}

export interface CalendarInvite {
  /** RFC 5545 text, CRLF-terminated as the spec requires. */
  icsContent: string;
  /** Suggested attachment filename. */
  filename: string;
  /** A one-click "add to Google Calendar" URL — a convenience alongside the
   * .ics attachment, not a replacement: it only ever helps a Google Calendar
   * user, while the .ics attachment works with any calendar client. */
  googleCalendarUrl: string;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** `YYYYMMDDTHHMMSSZ` — RFC 5545's UTC form (form 3 of §3.3.5), which is what
 * every field below uses so this never depends on the server's local zone. */
function formatIcsDateUtc(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** RFC 5545 §3.3.11 TEXT escaping — backslash first, so escaping the other
 * three characters doesn't re-escape the backslashes it just introduced. */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

const CRLF = "\r\n";
/** RFC 5545 §3.1 line folding: no physical line may exceed 75 octets, and a
 * continuation line starts with a single space. This is octet-counting on
 * the ASCII-safe assumption that content here has no multi-byte characters
 * (names/emails/session titles/meeting URLs) — the one place that would not
 * hold (a mentor's free-text bio) is deliberately never included in an ICS
 * field, only in the email body alongside it. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  let first = true;
  while (rest.length > 0) {
    const width = first ? 75 : 74; // a continuation line's leading space counts toward its own 75
    chunks.push(rest.slice(0, width));
    rest = rest.slice(width);
    first = false;
  }
  return chunks.join(CRLF + " ");
}

function icsLine(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

function attendeeLine(attendee: CalendarInviteAttendee): string {
  return foldLine(
    `ATTENDEE;CN=${escapeIcsText(attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:${attendee.email}`,
  );
}

/**
 * Builds a METHOD:REQUEST calendar invite for one mentorship session.
 *
 * METHOD:REQUEST (not PUBLISH) specifically because that is what makes Gmail
 * and Outlook render inline "Yes / No / Maybe" + "Add to calendar" controls
 * directly in the email body — the actual "make it feel real" goal this
 * whole slice exists for, not just an attachment nobody opens. Talentrah
 * itself is the ORGANIZER (never the mentor or mentee) since the same two
 * ATTENDEE entries and the same UID are mailed out to both parties from one
 * system identity, rather than modelling this as a person-to-person
 * calendar exchange.
 */
export function buildSessionCalendarInvite(input: CalendarInviteInput): CalendarInvite {
  const uid = `mentorship-session-${input.sessionId}@talentrah.com`;
  const now = formatIcsDateUtc(new Date());
  const start = formatIcsDateUtc(input.scheduledStart);
  const end = formatIcsDateUtc(input.scheduledEnd);
  const sequence = input.sequence ?? 0;

  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Talentrah//Mentorship//EN",
    "VERSION:2.0",
    "METHOD:REQUEST",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    icsLine("UID", uid),
    icsLine("DTSTAMP", now),
    icsLine("DTSTART", start),
    icsLine("DTEND", end),
    icsLine("SUMMARY", escapeIcsText(input.summary)),
    icsLine("DESCRIPTION", escapeIcsText(input.description)),
    icsLine("LOCATION", escapeIcsText(input.meetingLink)),
    "STATUS:CONFIRMED",
    icsLine("SEQUENCE", String(sequence)),
    foldLine(`ORGANIZER;CN=${escapeIcsText(input.organizer.name)}:mailto:${input.organizer.email}`),
    ...input.attendees.map(attendeeLine),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return {
    icsContent: lines.join(CRLF) + CRLF,
    filename: "mentorship-session.ics",
    googleCalendarUrl: buildGoogleCalendarLink(input),
  };
}

/**
 * A one-click "Add to Google Calendar" link — pure URL construction, no API
 * call and no OAuth, unlike actually creating the event via the Calendar API
 * (the heavier option this slice deliberately did not build; see 0138's
 * migration header). Genuinely additive convenience for a Google Calendar
 * user on top of the .ics attachment, which is what every OTHER calendar
 * client relies on.
 */
export function buildGoogleCalendarLink(input: CalendarInviteInput): string {
  const start = formatIcsDateUtc(input.scheduledStart);
  const end = formatIcsDateUtc(input.scheduledEnd);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.summary,
    dates: `${start}/${end}`,
    details: input.description,
    location: input.meetingLink,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
