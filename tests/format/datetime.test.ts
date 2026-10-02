/**
 * send-499 — ONE date and time formatter for the whole app.
 *
 * What the owner saw: Get Verified history "9/10/2026" (a Nigerian reads that as 9 October, a future date); mentorship
 * sessions "9/17/2026, 10:00:00 AM" (seconds, no zone); the tracker in US order; blog cards "SEPTEMBER 20, 2026" beside
 * "Sep 21, 2026" and "2 Oct 2026". About 60 call sites each chose their own.
 *
 * Founder rules:
 *   dates   "10 Sep 2026": day, short month, year; never all-numeric.
 *   times   "10:00 WAT": 24-hour, never seconds; in the viewer's zone when known, otherwise WAT (Africa/Lagos).
 *   relative times keep src/lib/format-relative-time.ts.
 *
 * The month names are spelled out by this module, not by Intl: ICU writes September as "Sept" in en-GB and "Sep" in
 * en-US, so asking the runtime would make the output depend on the Node build. Reached through loadModule so the file
 * compiles before the module exists.
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";

type Input = Date | string | number | null | undefined;
interface Mod {
  formatDate?: (v: Input, o?: { timeZone?: string }) => string;
  formatCalendarDate?: (ymd: string) => string;
  formatTime?: (v: Input, o?: { timeZone?: string }) => string;
  formatDateTime?: (v: Input, o?: { timeZone?: string }) => string;
  DEFAULT_TIME_ZONE?: string;
}
const mod = () => loadModule<Mod>("@/lib/format/datetime");
async function fn<K extends keyof Mod>(name: K): Promise<NonNullable<Mod[K]>> {
  const m = await mod();
  expect(m[name], `${String(name)} must be exported from src/lib/format/datetime.ts`).toBeDefined();
  return m[name] as NonNullable<Mod[K]>;
}

describe("the default zone", () => {
  it("is WAT, Africa/Lagos", async () => {
    expect((await mod()).DEFAULT_TIME_ZONE).toBe("Africa/Lagos");
  });
});

describe("formatDate: an instant, as a date in a zone", () => {
  it("renders day, short month, year, with no zero padding", async () => {
    const formatDate = await fn("formatDate");
    expect(formatDate("2026-09-10T09:00:00.000Z")).toBe("10 Sep 2026");
    expect(formatDate("2026-10-02T09:00:00.000Z")).toBe("2 Oct 2026");
    expect(formatDate("2027-01-05T09:00:00.000Z")).toBe("5 Jan 2027");
  });

  it("spells every month the same way regardless of the runtime's ICU (Sep, never Sept)", async () => {
    const formatDate = await fn("formatDate");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    months.forEach((m, i) => {
      expect(formatDate(new Date(Date.UTC(2026, i, 15, 12)))).toBe(`15 ${m} 2026`);
    });
  });

  it("is never all-numeric, for every day of a leap year", async () => {
    const formatDate = await fn("formatDate");
    for (let d = 0; d < 366; d++) {
      const out = formatDate(new Date(Date.UTC(2028, 0, 1 + d, 12)));
      expect(out, `day ${d}`).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
    }
  });

  it("uses the ZONE's calendar day, not UTC's: 23:30 UTC on 9 Sep is already 10 Sep in Lagos", async () => {
    const formatDate = await fn("formatDate");
    expect(formatDate("2026-09-09T23:30:00.000Z")).toBe("10 Sep 2026");
    expect(formatDate("2026-09-09T23:30:00.000Z", { timeZone: "UTC" })).toBe("9 Sep 2026");
    expect(formatDate("2026-09-10T03:00:00.000Z", { timeZone: "America/Los_Angeles" })).toBe("9 Sep 2026");
  });

  it("accepts a Date, an ISO string and epoch milliseconds, and gives the same answer", async () => {
    const formatDate = await fn("formatDate");
    const iso = "2026-09-10T09:00:00.000Z";
    expect(formatDate(new Date(iso))).toBe("10 Sep 2026");
    expect(formatDate(Date.parse(iso))).toBe("10 Sep 2026");
  });

  it("returns an empty string, not 'Invalid Date' or a crash, for nothing or garbage", async () => {
    const formatDate = await fn("formatDate");
    for (const bad of [null, undefined, "", "not a date", NaN, new Date("x")]) {
      expect(formatDate(bad as Input), String(bad)).toBe("");
    }
  });

  it("treats a bare YYYY-MM-DD as a CALENDAR date: it must not slide a day in a western zone", async () => {
    const formatDate = await fn("formatDate");
    expect(formatDate("2026-10-02")).toBe("2 Oct 2026");
    expect(formatDate("2026-10-02", { timeZone: "America/Los_Angeles" })).toBe("2 Oct 2026");
    expect(formatDate("2026-10-02", { timeZone: "Pacific/Kiritimati" })).toBe("2 Oct 2026");
  });
});

describe("formatCalendarDate: a date with no time and no zone (a deadline day, a birthday)", () => {
  it("formats the day as written", async () => {
    const formatCalendarDate = await fn("formatCalendarDate");
    expect(formatCalendarDate("2026-10-02")).toBe("2 Oct 2026");
    expect(formatCalendarDate("2027-03-31")).toBe("31 Mar 2027");
  });

  it("does not depend on the process's own time zone", async () => {
    const formatCalendarDate = await fn("formatCalendarDate");
    const before = process.env.TZ;
    try {
      for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Africa/Lagos"]) {
        process.env.TZ = tz;
        expect(formatCalendarDate("2026-10-02"), tz).toBe("2 Oct 2026");
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it("gives an empty string for anything that is not a real calendar day", async () => {
    const formatCalendarDate = await fn("formatCalendarDate");
    for (const bad of ["", "2026-13-01", "2026-02-30", "10/2/2026", "2 Oct 2026", "2026-10-02T00:00:00Z"]) {
      expect(formatCalendarDate(bad), bad).toBe("");
    }
  });
});

describe("formatTime: 24-hour, zone-labelled, never seconds", () => {
  it("shows 10:00 WAT for 09:00 UTC", async () => {
    const formatTime = await fn("formatTime");
    expect(formatTime("2026-09-17T09:00:00.000Z")).toBe("10:00 WAT");
  });

  it("never prints seconds, whatever the instant carries", async () => {
    const formatTime = await fn("formatTime");
    expect(formatTime("2026-09-17T09:00:45.678Z")).toBe("10:00 WAT");
    expect(formatTime("2026-09-17T09:00:45.678Z")).not.toMatch(/\d:\d\d:\d\d/);
  });

  it("is 24-hour with a two-digit hour and minute: 00:05, 12:00, 13:00, 23:59", async () => {
    const formatTime = await fn("formatTime");
    expect(formatTime("2026-09-16T23:05:00.000Z", { timeZone: "UTC" })).toBe("23:05 UTC");
    expect(formatTime("2026-09-17T00:05:00.000Z", { timeZone: "UTC" })).toBe("00:05 UTC");
    expect(formatTime("2026-09-17T12:00:00.000Z", { timeZone: "UTC" })).toBe("12:00 UTC");
    expect(formatTime("2026-09-17T13:00:00.000Z", { timeZone: "UTC" })).toBe("13:00 UTC");
    expect(formatTime("2026-09-17T23:59:00.000Z", { timeZone: "UTC" })).toBe("23:59 UTC");
  });

  it("uses the viewer's zone when one is given, and labels it", async () => {
    const formatTime = await fn("formatTime");
    expect(formatTime("2026-10-06T17:00:00.000Z", { timeZone: "America/Toronto" })).toBe("13:00 EDT");
    expect(formatTime("2026-10-06T20:00:00.000Z", { timeZone: "America/Los_Angeles" })).toBe("13:00 PDT");
    expect(formatTime("2026-12-06T17:00:00.000Z", { timeZone: "America/Toronto" })).toBe("12:00 EST");
  });

  it("labels the African zones the way the people in them say them", async () => {
    const formatTime = await fn("formatTime");
    const at = "2026-09-17T09:00:00.000Z";
    expect(formatTime(at, { timeZone: "Africa/Lagos" })).toBe("10:00 WAT");
    expect(formatTime(at, { timeZone: "Africa/Accra" })).toBe("09:00 GMT");
    expect(formatTime(at, { timeZone: "Africa/Nairobi" })).toBe("12:00 EAT");
    expect(formatTime(at, { timeZone: "Africa/Johannesburg" })).toBe("11:00 SAST");
  });

  it("falls back to WAT for a zone name it cannot use, rather than throwing", async () => {
    const formatTime = await fn("formatTime");
    expect(formatTime("2026-09-17T09:00:00.000Z", { timeZone: "Not/AZone" })).toBe("10:00 WAT");
  });

  it("returns an empty string for nothing or garbage", async () => {
    const formatTime = await fn("formatTime");
    expect(formatTime(null)).toBe("");
    expect(formatTime("nope")).toBe("");
  });
});

describe("formatDateTime: both, as the sessions page needs them", () => {
  it("the owner's mentorship session: '9/17/2026, 10:00:00 AM' becomes '17 Sep 2026, 10:00 WAT'", async () => {
    const formatDateTime = await fn("formatDateTime");
    expect(formatDateTime("2026-09-17T09:00:00.000Z")).toBe("17 Sep 2026, 10:00 WAT");
  });

  it("takes the date from the same zone as the time (no 'date in UTC, time in Lagos' split)", async () => {
    const formatDateTime = await fn("formatDateTime");
    expect(formatDateTime("2026-09-09T23:30:00.000Z")).toBe("10 Sep 2026, 00:30 WAT");
    expect(formatDateTime("2026-09-09T23:30:00.000Z", { timeZone: "UTC" })).toBe("9 Sep 2026, 23:30 UTC");
  });

  it("gives an empty string for nothing or garbage", async () => {
    const formatDateTime = await fn("formatDateTime");
    expect(formatDateTime(undefined)).toBe("");
  });
});
