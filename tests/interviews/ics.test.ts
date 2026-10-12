import { describe, expect, it } from "vitest";
import { buildIcs } from "@/lib/interviews/ics";

const base = { uid: "booking-1@talentrah.com", startsAtIso: "2026-10-26T09:00:00Z", durationMinutes: 45, summary: "Interview: Growth Marketer at Zimcrest", description: "Video interview.", location: "" };

describe("buildIcs: a calendar file both people can open", () => {
  const ics = buildIcs(base);
  const lines = ics.split("\r\n");

  it("is a CRLF-terminated VCALENDAR with one VEVENT", () => {
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("BEGIN:VEVENT");
    expect(lines).toContain("END:VEVENT");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it("stores the start and end in UTC, so the viewer's own calendar shows their own zone, before and after the UK clock change", () => {
    expect(ics).toContain("DTSTART:20261026T090000Z");
    expect(ics).toContain("DTEND:20261026T094500Z");
    expect(buildIcs({ ...base, startsAtIso: "2026-10-24T09:00:00Z" })).toContain("DTSTART:20261024T090000Z");
  });

  it("carries the UID, a stamp and the summary; an empty location is left out", () => {
    expect(ics).toContain("UID:booking-1@talentrah.com");
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
    expect(ics).toContain("SUMMARY:Interview: Growth Marketer at Zimcrest");
    expect(ics).not.toContain("LOCATION:");
    expect(buildIcs({ ...base, location: "Lagos office" })).toContain("LOCATION:Lagos office");
  });

  it("escapes commas, semicolons, backslashes and newlines in text values", () => {
    const e = buildIcs({ ...base, summary: "A, B; C\\D", description: "line one\nline two" });
    expect(e).toContain("SUMMARY:A\\, B\\; C\\\\D");
    expect(e).toContain("DESCRIPTION:line one\\nline two");
  });

  it("escapes the backslash first, so a semicolon or comma that follows one is escaped once and not twice", () => {
    expect(buildIcs({ ...base, summary: "a\\;b\\,c;d,e" })).toContain("SUMMARY:a\\\\\\;b\\\\\\,c\\;d\\,e");
  });

  it("cannot be made to start a new calendar line by a lone carriage return, a line feed or a control character in the note", () => {
    const e = buildIcs({ ...base, summary: "Hi\rATTENDEE:mailto:x@y.z", description: "a\nb\r\nc\rBEGIN:VEVENT\u0000d\u0007e\u000bf\u2028g\tz", location: "L\u001bATTENDEE:q" });
    const lines = e.replace(/\r\n /g, "").split("\r\n");
    expect(lines.filter((l) => /^(ATTENDEE|BEGIN:VEVENT)/.test(l)), "a note line became a calendar line").toEqual(["BEGIN:VEVENT"]);
    expect(e.replace(/\r\n/g, "")).not.toMatch(/[\u0000-\u001f\u007f\u2028\u2029]/);
    expect(lines).toContain("DESCRIPTION:a\\nb\\nc\\nBEGIN:VEVENTdefg z");
  });

  it("folds lines longer than 75 octets with a CRLF and a space, never splitting inside a multi-byte character", () => {
    const e = buildIcs({ ...base, description: "é".repeat(100) });
    for (const line of e.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const unfolded = e.replace(/\r\n /g, "");
    expect(unfolded).toContain("DESCRIPTION:" + "é".repeat(100));
  });

  it("refuses a start time that is not a real instant", () => {
    expect(() => buildIcs({ ...base, startsAtIso: "not a date" })).toThrow();
  });
});
