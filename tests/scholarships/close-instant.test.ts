/**
 * send-508 / S3-21a — a scholarship closes at an INSTANT, and the TypeScript and SQL definitions agree.
 *
 * The rule (owner's call): zone + time known -> that wall-clock time in that IANA zone; zone but no time -> the END of that day in that
 * zone; neither -> the end of the day at UTC-12, and the UI says "time zone not stated, apply a day early". Open means now < the closing
 * instant, so AT the instant it is closed.
 *
 * The expected values in the parity table are what Postgres's own scholarship_close_instant returned for the same inputs, run against a real
 * Postgres inside a rolled-back transaction (0204; output in the PR body). tests/scholarships/close-instant-sql.test.ts re-runs the same
 * table against the migration in CI's database, so the twins cannot drift.
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";

interface Row {
  application_deadline: string | null;
  close_time: string | null;
  close_tz: string | null;
}
interface Mod {
  scholarshipCloseInstant?: (row: Row) => Date | null;
  isScholarshipOpen?: (row: Row, now: Date) => boolean;
  scholarshipDaysLeft?: (row: Row, now: Date) => number | null;
  scholarshipCloseText?: (row: Row) => string | null;
}
const mod = () => loadModule<Mod>("@/lib/scholarships/close-instant");
const get = async <K extends keyof Mod>(k: K): Promise<NonNullable<Mod[K]>> => {
  const m = await mod();
  expect(m[k], `${String(k)} must be exported from src/lib/scholarships/close-instant.ts`).toBeTypeOf("function");
  return m[k] as NonNullable<Mod[K]>;
};

const row = (d: string | null, t: string | null = null, tz: string | null = null): Row => ({ application_deadline: d, close_time: t, close_tz: tz });

/** [deadline, time, tz, expected UTC instant from Postgres] */
export const PARITY: Array<[string, string | null, string | null, string]> = [
  ["2026-10-06", "13:00", "America/Vancouver", "2026-10-06T20:00:00.000Z"],
  ["2026-10-06", null, "Africa/Lagos", "2026-10-06T23:00:00.000Z"],
  ["2026-10-06", null, null, "2026-10-07T12:00:00.000Z"],
  ["2026-10-06", "23:59", "America/Toronto", "2026-10-07T03:59:00.000Z"],
  ["2026-01-15", "12:59", "Europe/Zurich", "2026-01-15T11:59:00.000Z"],
  ["2026-06-15", "12:59", "Europe/Zurich", "2026-06-15T10:59:00.000Z"],
  // Daylight-saving gap and overlap: Postgres resolves both to the STANDARD offset.
  ["2026-03-08", "02:30", "America/Toronto", "2026-03-08T07:30:00.000Z"],
  ["2026-11-01", "01:30", "America/Toronto", "2026-11-01T06:30:00.000Z"],
  ["2026-10-06", "11:00", "UTC", "2026-10-06T11:00:00.000Z"],
  ["2026-10-06", "23:30", "Asia/Kolkata", "2026-10-06T18:00:00.000Z"],
  ["2026-10-06", "00:00", "Pacific/Kiritimati", "2026-10-05T10:00:00.000Z"],
  ["2026-10-06", "12:00", "Europe/Moscow", "2026-10-06T09:00:00.000Z"],
  ["2026-03-29", "02:30", "Europe/Zurich", "2026-03-29T01:30:00.000Z"],
  ["2026-10-25", "02:30", "Europe/Zurich", "2026-10-25T01:30:00.000Z"],
  ["2026-10-06", null, "America/Toronto", "2026-10-07T04:00:00.000Z"],
  ["2026-12-31", null, null, "2027-01-01T12:00:00.000Z"],
];

describe("scholarshipCloseInstant: the same instant Postgres computes", () => {
  it.each(PARITY)("%s %s %s -> %s", async (d, t, tz, expected) => {
    const f = await get("scholarshipCloseInstant");
    expect(f(row(d, t, tz))?.toISOString()).toBe(expected);
  });

  it("no deadline: no instant", async () => {
    expect((await get("scholarshipCloseInstant"))(row(null, "13:00", "UTC"))).toBeNull();
  });

  it("seconds in the time are honoured (HH:MM:SS, as Postgres returns a time)", async () => {
    expect((await get("scholarshipCloseInstant"))(row("2026-10-06", "13:00:30", "UTC"))?.toISOString()).toBe("2026-10-06T13:00:30.000Z");
  });

  it("an unknown zone name falls back to the no-zone rule rather than throwing (the DB refuses one, but never trust it here)", async () => {
    const f = await get("scholarshipCloseInstant");
    expect(f(row("2026-10-06", "13:00", "Mars/Phobos"))?.toISOString()).toBe("2026-10-07T12:00:00.000Z");
  });

  it("a time with no zone is ignored (the DB refuses that row): the no-zone rule applies", async () => {
    expect((await get("scholarshipCloseInstant"))(row("2026-10-06", "13:00", null))?.toISOString()).toBe("2026-10-07T12:00:00.000Z");
  });
});

describe("isScholarshipOpen at the boundary minute, in UTC, Lagos, Toronto and with no zone", () => {
  const minute = 60_000;
  // each case: the row, and the closing instant it must produce
  const CASES: Array<[string, Row, string]> = [
    ["UTC", row("2026-10-06", "09:30", "UTC"), "2026-10-06T09:30:00.000Z"],
    ["Lagos", row("2026-10-06", "17:00", "Africa/Lagos"), "2026-10-06T16:00:00.000Z"],
    ["Toronto", row("2026-10-06", "17:00", "America/Toronto"), "2026-10-06T21:00:00.000Z"],
    ["no zone", row("2026-10-06"), "2026-10-07T12:00:00.000Z"],
    ["zone, no time (Lagos)", row("2026-10-06", null, "Africa/Lagos"), "2026-10-06T23:00:00.000Z"],
  ];

  it.each(CASES)("%s: open one minute before, closed AT the instant, closed after", async (_name, r, iso) => {
    const open = await get("isScholarshipOpen");
    const t = Date.parse(iso);
    expect(open(r, new Date(t - minute)), "one minute before").toBe(true);
    expect(open(r, new Date(t - 1_000)), "one second before").toBe(true);
    expect(open(r, new Date(t)), "at the closing instant").toBe(false);
    expect(open(r, new Date(t + minute)), "one minute after").toBe(false);
  });

  it("a scholarship with no deadline is always open", async () => {
    expect((await get("isScholarshipOpen"))(row(null), new Date("2099-01-01T00:00:00Z"))).toBe(true);
  });

  it("the same calendar deadline is not the same moment in Lagos and Toronto (the bug the date rule had)", async () => {
    const open = await get("isScholarshipOpen");
    const now = new Date("2026-10-06T23:30:00.000Z"); // 00:30 on the 7th in Lagos, 19:30 on the 6th in Toronto
    expect(open(row("2026-10-06", null, "Africa/Lagos"), now), "Lagos: the 6th is over").toBe(false);
    expect(open(row("2026-10-06", null, "America/Toronto"), now), "Toronto: still the 6th").toBe(true);
  });
});

describe("scholarshipDaysLeft", () => {
  it("null with no deadline; negative once closed; 0 inside the last 24 hours; whole days otherwise", async () => {
    const f = await get("scholarshipDaysLeft");
    const r = row("2026-10-06", "12:00", "UTC");
    expect(f(row(null), new Date("2026-10-01T00:00:00Z"))).toBeNull();
    expect(f(r, new Date("2026-10-06T12:00:00Z"))! < 0, "closed at the instant").toBe(true);
    expect(f(r, new Date("2026-10-06T11:59:00Z"))).toBe(0);
    expect(f(r, new Date("2026-10-05T12:00:01Z"))).toBe(0);
    expect(f(r, new Date("2026-10-05T12:00:00Z"))).toBe(1);
    expect(f(r, new Date("2026-10-01T12:00:00Z"))).toBe(5);
  });
});

describe("scholarshipCloseText: what a reader is told", () => {
  it("zone and time: 'Closes 6 Oct 2026, 13:00 (Pacific time)'", async () => {
    expect((await get("scholarshipCloseText"))(row("2026-10-06", "13:00", "America/Vancouver"))).toBe("Closes 6 Oct 2026, 13:00 (Pacific time)");
  });

  it("another zone reads the same way", async () => {
    expect((await get("scholarshipCloseText"))(row("2026-01-15", "12:59", "Europe/Zurich"))).toBe("Closes 15 Jan 2026, 12:59 (Central European time)");
  });

  it("a zone but no time: end of that day there", async () => {
    expect((await get("scholarshipCloseText"))(row("2026-10-06", null, "Africa/Lagos"))).toBe("Closes 6 Oct 2026, end of day (West Africa time)");
  });

  it("no zone: says so, and tells the reader to apply a day early", async () => {
    expect((await get("scholarshipCloseText"))(row("2026-10-06"))).toBe("Closes 6 Oct 2026 — time zone not stated, apply a day early");
  });

  it("no deadline: nothing to say", async () => {
    expect((await get("scholarshipCloseText"))(row(null))).toBeNull();
  });
});
