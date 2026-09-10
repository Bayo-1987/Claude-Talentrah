/**
 * Pure unit tests for the .ics generator (src/lib/mentorship/calendar-invite.ts)
 * — no DB, no network, matching this module's own "pure and side-effect free"
 * header. The DB-backed send path (attaching this to a real confirmation/
 * reminder email) is covered separately in session-notifications.test.ts and
 * session-reminders.test.ts.
 */
import { describe, expect, it } from "vitest";
import { buildSessionCalendarInvite, buildGoogleCalendarLink } from "@/lib/mentorship/calendar-invite";

const BASE_INPUT = {
  sessionId: "11111111-2222-3333-4444-555555555555",
  summary: "Resume review — Talentrah Mentorship",
  description: "Join the call: https://meet.jit.si/talentrah-abc123",
  meetingLink: "https://meet.jit.si/talentrah-abc123",
  scheduledStart: "2026-09-15T14:00:00.000Z",
  scheduledEnd: "2026-09-15T14:30:00.000Z",
  organizer: { name: "Talentrah", email: "sessions@talentrah.com" },
  attendees: [
    { name: "Ada Mentor", email: "ada@talentrah.test" },
    { name: "Bola Mentee", email: "bola@talentrah.test" },
  ],
};

describe("buildSessionCalendarInvite", () => {
  it("produces a well-formed VCALENDAR/VEVENT with METHOD:REQUEST", () => {
    const { icsContent } = buildSessionCalendarInvite(BASE_INPUT);
    expect(icsContent).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(icsContent).toContain("METHOD:REQUEST\r\n");
    expect(icsContent).toContain("BEGIN:VEVENT\r\n");
    expect(icsContent).toContain("END:VEVENT\r\n");
    expect(icsContent.trimEnd()).toMatch(/END:VCALENDAR$/);
  });

  it("is CRLF-terminated throughout, per RFC 5545 §3.1", () => {
    const { icsContent } = buildSessionCalendarInvite(BASE_INPUT);
    // Every line break in the content is CRLF, never a bare LF.
    const withoutCrlf = icsContent.replace(/\r\n/g, "");
    expect(withoutCrlf).not.toContain("\n");
  });

  it("the UID is stable and derived from the session id — the same session always produces the same UID", () => {
    const first = buildSessionCalendarInvite(BASE_INPUT);
    const second = buildSessionCalendarInvite(BASE_INPUT);
    const uidOf = (ics: string) => ics.match(/UID:([^\r\n]+)/)?.[1];
    expect(uidOf(first.icsContent)).toBe(uidOf(second.icsContent));
    expect(uidOf(first.icsContent)).toContain(BASE_INPUT.sessionId);
  });

  it("two DIFFERENT sessions get two different UIDs", () => {
    const other = buildSessionCalendarInvite({ ...BASE_INPUT, sessionId: "99999999-8888-7777-6666-555555555555" });
    const base = buildSessionCalendarInvite(BASE_INPUT);
    const uidOf = (ics: string) => ics.match(/UID:([^\r\n]+)/)?.[1];
    expect(uidOf(other.icsContent)).not.toBe(uidOf(base.icsContent));
  });

  it("DTSTART/DTEND are the UTC form (YYYYMMDDTHHMMSSZ), matching the input instant exactly", () => {
    const { icsContent } = buildSessionCalendarInvite(BASE_INPUT);
    expect(icsContent).toContain("DTSTART:20260915T140000Z");
    expect(icsContent).toContain("DTEND:20260915T143000Z");
  });

  it("escapes commas, semicolons and newlines in free text per RFC 5545 §3.3.11", () => {
    const { icsContent } = buildSessionCalendarInvite({
      ...BASE_INPUT,
      summary: "Career strategy, part 1; the sequel",
      description: "Line one\nLine two",
    });
    expect(icsContent).toContain("SUMMARY:Career strategy\\, part 1\\; the sequel");
    expect(icsContent).toContain("DESCRIPTION:Line one\\nLine two");
  });

  it("escapes a literal backslash BEFORE escaping the characters it introduces (order matters)", () => {
    const { icsContent } = buildSessionCalendarInvite({ ...BASE_INPUT, summary: "back\\slash" });
    // A naive escape-comma-then-backslash order would double-escape; done
    // correctly, exactly one backslash becomes exactly two.
    expect(icsContent).toContain("SUMMARY:back\\\\slash");
  });

  it("folds a line longer than 75 octets, with a leading space on the continuation", () => {
    const longSummary = "A".repeat(120);
    const { icsContent } = buildSessionCalendarInvite({ ...BASE_INPUT, summary: longSummary });
    const summaryLine = icsContent.split("\r\n").find((l) => l.startsWith("SUMMARY:"));
    expect(summaryLine!.length).toBeLessThanOrEqual(75);
    // The folded continuation exists and starts with a single space.
    const idx = icsContent.indexOf("SUMMARY:");
    const after = icsContent.slice(idx);
    const [, second] = after.split("\r\n");
    expect(second.startsWith(" ")).toBe(true);
  });

  it("includes both attendees and the organizer as Talentrah, never the mentor or mentee", () => {
    const { icsContent } = buildSessionCalendarInvite(BASE_INPUT);
    // Unfold first (RFC 5545 §3.1: a CRLF followed by a single space is a
    // fold, not a real line break) — an ATTENDEE line here is long enough
    // that it legitimately folds, and a reader (real or this assertion) has
    // to undo that before looking for a substring across the fold point.
    const unfolded = icsContent.replace(/\r\n /g, "");
    expect(unfolded).toMatch(/ORGANIZER;CN=Talentrah:mailto:sessions@talentrah\.com/);
    expect(unfolded).toContain("mailto:ada@talentrah.test");
    expect(unfolded).toContain("mailto:bola@talentrah.test");
  });

  it("LOCATION carries the meeting link, so a calendar client's own join affordance works", () => {
    const { icsContent } = buildSessionCalendarInvite(BASE_INPUT);
    expect(icsContent).toContain(`LOCATION:${BASE_INPUT.meetingLink}`);
  });

  it("also returns a Google Calendar add-link with the same start/end", () => {
    const { googleCalendarUrl } = buildSessionCalendarInvite(BASE_INPUT);
    expect(googleCalendarUrl).toContain("calendar.google.com/calendar/render");
    expect(googleCalendarUrl).toContain("dates=20260915T140000Z%2F20260915T143000Z");
  });
});

describe("buildGoogleCalendarLink", () => {
  it("is a plain URL — no API call, no OAuth", () => {
    const url = buildGoogleCalendarLink(BASE_INPUT);
    expect(() => new URL(url)).not.toThrow();
    expect(new URL(url).searchParams.get("action")).toBe("TEMPLATE");
  });
});
