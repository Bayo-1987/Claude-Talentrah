/**
 * send-511 — the countdown for a scholarship whose deadline has NO stated zone.
 *
 * 0204 keeps such a row LISTED until the last place on Earth has ended the day (12:00 UTC the next day). That rule is right for "does it
 * show", wrong for "how many days left": on 2 Oct itself the page said "1 day left" next to "apply a day early". The count must use the
 * stated DATE, in four states, all read off one timeline anchored on the EARLIEST zone (UTC+14, Kiritimati), where the date begins first and
 * ends first. For a deadline date D:
 *
 *   before the date has begun anywhere (now < D 00:00 at UTC+14)   "N days left", N = calendar days to D
 *   the date is current somewhere, not yet over in UTC+14         "Last day: deadline D, time zone not stated. Apply now."
 *   over in UTC+14, not yet over in UTC-12 (= the 0204 instant)    "Deadline date has passed in some time zones. May already be closed."
 *   at or after the closing instant (D+1 12:00 UTC)                closed
 *
 * NO NO-ZONE STATE SAYS "today" (owner's correction): "today" depends on the reader's zone, so wording anchored on UTC+14 would sit next to a date
 * that is still tomorrow for a reader in the Americas. The words must be true everywhere.
 *
 * A row WITH a zone has an exact instant, so its countdown is true for every reader: "N days left" from 24 hours out, "Closes in N hours" under
 * 24 hours, "Closes in under an hour" under one. (It used to say "0 days left".)
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";

interface Row {
  application_deadline: string | null;
  close_time: string | null;
  close_tz: string | null;
}
interface Countdown {
  state: "none" | "days" | "hours" | "under-hour" | "today" | "passed-somewhere" | "closed";
  days: number | null;
  hours: number | null;
  phrase: string | null;
  /** True when the phrase is the whole statement (it carries the date) and replaces the date, rather than following it. */
  standalone: boolean;
  urgent: boolean;
}
interface Mod {
  scholarshipCountdown?: (row: Row, now: Date) => Countdown;
  scholarshipCloseText?: (row: Row, now?: Date) => string | null;
  scholarshipDeadlineDisplay?: (row: Row, now: Date, opts: { detailed: boolean; showClosed: boolean }) => { text: string; urgent: boolean } | null;
  scholarshipDeadlineStatement?: (row: Row) => string | null;
  isScholarshipOpen?: (row: Row, now: Date) => boolean;
}
const get = async <K extends keyof Mod>(k: K): Promise<NonNullable<Mod[K]>> => {
  const m = await loadModule<Mod>("@/lib/scholarships/close-instant");
  expect(m[k], `${String(k)} must be exported from src/lib/scholarships/close-instant.ts`).toBeTypeOf("function");
  return m[k] as NonNullable<Mod[K]>;
};

const NO_ZONE: Row = { application_deadline: "2026-10-06", close_time: null, close_tz: null };
const at = (iso: string) => new Date(iso);

const LAST_DAY = "Last day: deadline 6 Oct 2026, time zone not stated. Apply now.";
const PASSED = "Deadline date has passed in some time zones. May already be closed.";

describe("no zone: the four states (deadline 6 Oct 2026)", () => {
  it("before the date has begun anywhere: calendar days to the stated date", async () => {
    const c = await get("scholarshipCountdown");
    // 12:00Z on 1 Oct is 02:00 on 2 Oct at UTC+14: 4 calendar days to 6 Oct.
    expect(c(NO_ZONE, at("2026-10-01T12:00:00Z"))).toMatchObject({ state: "days", days: 4, phrase: "4 days left", urgent: true });
    expect(c(NO_ZONE, at("2026-09-20T09:00:00Z"))).toMatchObject({ state: "days", days: 16, phrase: "16 days left", urgent: false });
  });

  it("the last second before the date begins in UTC+14 (5 Oct 09:59:59Z): '1 day left', the last of the 'N days' state", async () => {
    const c = await get("scholarshipCountdown");
    expect(c(NO_ZONE, at("2026-10-05T09:59:59Z"))).toMatchObject({ state: "days", days: 1, phrase: "1 day left" });
  });

  it("the moment the date begins in UTC+14 (5 Oct 10:00:00Z) until it ends there (6 Oct 09:59:59Z): 'Last day, apply now'", async () => {
    const c = await get("scholarshipCountdown");
    expect(c(NO_ZONE, at("2026-10-05T10:00:00Z"))).toMatchObject({ state: "today", phrase: LAST_DAY, standalone: true, urgent: true });
    expect(c(NO_ZONE, at("2026-10-06T00:00:00Z"))).toMatchObject({ state: "today", phrase: LAST_DAY });
    expect(c(NO_ZONE, at("2026-10-06T09:59:59Z"))).toMatchObject({ state: "today", phrase: LAST_DAY });
  });

  it("from the end of the date in UTC+14 (6 Oct 10:00:00Z) to the last place's end (7 Oct 11:59:59Z): 'has passed in some time zones'", async () => {
    const c = await get("scholarshipCountdown");
    expect(c(NO_ZONE, at("2026-10-06T10:00:00Z"))).toMatchObject({ state: "passed-somewhere", phrase: PASSED, urgent: true });
    expect(c(NO_ZONE, at("2026-10-06T23:30:00Z"))).toMatchObject({ state: "passed-somewhere", phrase: PASSED });
    expect(c(NO_ZONE, at("2026-10-07T11:59:59Z"))).toMatchObject({ state: "passed-somewhere", phrase: PASSED });
  });

  it("at the closing instant (7 Oct 12:00:00Z) it is closed, and the 0204 'open' rule agrees (this PR does not move it)", async () => {
    const c = await get("scholarshipCountdown");
    const open = await get("isScholarshipOpen");
    expect(c(NO_ZONE, at("2026-10-07T12:00:00Z"))).toMatchObject({ state: "closed", phrase: "Closed", urgent: false });
    expect(open(NO_ZONE, at("2026-10-07T11:59:59Z"))).toBe(true);
    expect(open(NO_ZONE, at("2026-10-07T12:00:00Z"))).toBe(false);
  });

  it("the reported case: Trudeau on 2 Oct itself, which used to say '1 day left'", async () => {
    const c = await get("scholarshipCountdown");
    const trudeau: Row = { application_deadline: "2026-10-02", close_time: null, close_tz: null };
    for (const now of ["2026-10-02T00:05:00Z", "2026-10-02T08:30:00Z", "2026-10-02T09:59:00Z"]) {
      const r = c(trudeau, at(now));
      expect(r.state, now).toBe("today");
      expect(r.phrase, now).toBe("Last day: deadline 2 Oct 2026, time zone not stated. Apply now.");
      expect(r.phrase, now).not.toMatch(/day left/);
    }
  });

  it("the days state never says '0 days left' and never contradicts 'apply a day early' with a count of 1 on the day itself", async () => {
    const c = await get("scholarshipCountdown");
    for (let h = 0; h < 24 * 8; h++) {
      const now = new Date(Date.parse("2026-09-28T00:00:00Z") + h * 3_600_000);
      const r = c(NO_ZONE, now);
      if (r.state === "days") expect(r.days).toBeGreaterThanOrEqual(1);
    }
  });

  it("the closing text for the two 'date' states is the date alone (the phrase carries the caution); before the date it keeps 'apply a day early'", async () => {
    const text = await get("scholarshipCloseText");
    expect(text(NO_ZONE, at("2026-10-01T12:00:00Z"))).toBe("Closes 6 Oct 2026 — time zone not stated, apply a day early");
    expect(text(NO_ZONE, at("2026-10-06T05:00:00Z"))).toBe("6 Oct 2026");
    expect(text(NO_ZONE, at("2026-10-06T23:30:00Z"))).toBe("6 Oct 2026");
  });
});

describe("a row WITH a zone: an exact instant, so the countdown is true for every reader", () => {
  const toronto: Row = { application_deadline: "2026-10-06", close_time: "23:59", close_tz: "America/Toronto" }; // closes 7 Oct 03:59Z
  const chevening: Row = { application_deadline: "2026-10-06", close_time: "11:00", close_tz: "UTC" }; // closes 6 Oct 11:00Z

  it("on its deadline day: 'Closes in N hours', never '0 days left' (Toronto row, 6 Oct 12:00Z, 15h59m to go)", async () => {
    const c = await get("scholarshipCountdown");
    expect(c(toronto, at("2026-10-06T12:00:00Z"))).toMatchObject({ state: "hours", hours: 15, phrase: "Closes in 15 hours", standalone: false, urgent: true });
  });

  it("Chevening 23 hours 30 minutes before 11:00Z: 'Closes in 23 hours'", async () => {
    const c = await get("scholarshipCountdown");
    expect(c(chevening, at("2026-10-05T11:30:00Z"))).toMatchObject({ state: "hours", hours: 23, phrase: "Closes in 23 hours" });
  });

  it("the exact boundary seconds around 24 hours: exactly 24h is '1 day left', one second inside is '23 hours'", async () => {
    const c = await get("scholarshipCountdown");
    expect(c(chevening, at("2026-10-05T11:00:00Z"))).toMatchObject({ state: "days", days: 1, phrase: "1 day left" });
    expect(c(chevening, at("2026-10-05T10:59:59Z"))).toMatchObject({ state: "days", days: 1 });
    expect(c(chevening, at("2026-10-05T11:00:01Z"))).toMatchObject({ state: "hours", hours: 23, phrase: "Closes in 23 hours" });
    expect(c(chevening, at("2026-10-04T11:00:00Z"))).toMatchObject({ state: "days", days: 2, phrase: "2 days left" });
  });

  it("the exact boundary seconds around one hour: exactly 1h is 'Closes in 1 hour', one second inside is 'under an hour'", async () => {
    const c = await get("scholarshipCountdown");
    expect(c(chevening, at("2026-10-06T10:00:00Z"))).toMatchObject({ state: "hours", hours: 1, phrase: "Closes in 1 hour" });
    expect(c(chevening, at("2026-10-06T09:59:59Z"))).toMatchObject({ state: "hours", hours: 1 });
    expect(c(chevening, at("2026-10-06T10:00:01Z"))).toMatchObject({ state: "under-hour", hours: null, phrase: "Closes in under an hour", urgent: true });
    expect(c(chevening, at("2026-10-06T10:59:59Z"))).toMatchObject({ state: "under-hour", phrase: "Closes in under an hour" });
  });

  it("at the closing instant it is closed; 4 days out it still says '4 days left'", async () => {
    const c = await get("scholarshipCountdown");
    expect(c(chevening, at("2026-10-06T11:00:00Z"))).toMatchObject({ state: "closed", phrase: "Closed", urgent: false });
    expect(c(chevening, at("2026-10-02T08:30:00Z"))).toMatchObject({ state: "days", days: 4, phrase: "4 days left" });
  });

  it("a zone with no time keeps its end-of-day instant: Lagos 6 Oct closes 23:00Z, so 10:00Z is '13 hours'", async () => {
    const c = await get("scholarshipCountdown");
    const lagos: Row = { application_deadline: "2026-10-06", close_time: null, close_tz: "Africa/Lagos" };
    expect(c(lagos, at("2026-10-06T10:00:00Z"))).toMatchObject({ state: "hours", hours: 13, phrase: "Closes in 13 hours" });
    expect(c(lagos, at("2026-10-06T23:00:00Z")).state).toBe("closed");
  });

  it("the word 'today' and the phrase '0 days left' appear in no zoned state either", async () => {
    const c = await get("scholarshipCountdown");
    for (let m = 0; m <= 6 * 24 * 60; m += 7) {
      const r = c(chevening, new Date(Date.parse("2026-10-01T00:00:00Z") + m * 60_000));
      expect(r.phrase ?? "").not.toMatch(/today|0 days left/i);
    }
  });

  it("no deadline: no countdown at all", async () => {
    const c = await get("scholarshipCountdown");
    expect(c({ application_deadline: null, close_time: null, close_tz: null }, at("2026-10-06T10:00:00Z"))).toMatchObject({ state: "none", days: null, phrase: null, urgent: false });
  });
});

describe("no no-zone state contains the word 'today' (it depends on the reader's zone)", () => {
  it("sweeping every 30 minutes across 10 days around the deadline, neither the phrase nor the closing text says 'today'", async () => {
    const c = await get("scholarshipCountdown");
    const text = await get("scholarshipCloseText");
    const states = new Set<string>();
    for (let m = 0; m <= 10 * 24 * 60; m += 30) {
      const now = new Date(Date.parse("2026-10-01T00:00:00Z") + m * 60_000);
      const r = c(NO_ZONE, now);
      states.add(r.state);
      expect(r.phrase ?? "", `phrase at ${now.toISOString()}`).not.toMatch(/today/i);
      expect(text(NO_ZONE, now) ?? "", `text at ${now.toISOString()}`).not.toMatch(/today/i);
    }
    expect([...states].sort()).toEqual(["closed", "days", "passed-somewhere", "today"]);
  });
});

describe("the one display builder the five sites share", () => {
  const display = async () => get("scholarshipDeadlineDisplay");

  it("compact (card, embed, landing): the date, then the countdown after a dot; the 'last day' statement replaces the date", async () => {
    const d = await display();
    expect(d(NO_ZONE, at("2026-10-01T12:00:00Z"), { detailed: false, showClosed: false })).toEqual({ text: "6 Oct 2026 · 4 days left", urgent: true });
    expect(d(NO_ZONE, at("2026-10-06T05:00:00Z"), { detailed: false, showClosed: false })).toEqual({ text: LAST_DAY, urgent: true });
    expect(d(NO_ZONE, at("2026-10-06T23:30:00Z"), { detailed: false, showClosed: false })).toEqual({ text: `6 Oct 2026 · ${PASSED}`, urgent: true });
  });

  it("detailed (the detail page): the full closing text, with 'Closed' shown when it is", async () => {
    const d = await display();
    const chev: Row = { application_deadline: "2026-10-06", close_time: "11:00", close_tz: "UTC" };
    expect(d(chev, at("2026-10-02T08:30:00Z"), { detailed: true, showClosed: true })).toEqual({ text: "Closes 6 Oct 2026, 11:00 UTC · 4 days left", urgent: true });
    expect(d(chev, at("2026-10-06T05:00:00Z"), { detailed: true, showClosed: true })).toEqual({ text: "Closes 6 Oct 2026, 11:00 UTC · Closes in 6 hours", urgent: true });
    expect(d(chev, at("2026-10-06T11:00:00Z"), { detailed: true, showClosed: true })).toEqual({ text: "Closes 6 Oct 2026, 11:00 UTC · Closed", urgent: false });
    expect(d(chev, at("2026-10-06T11:00:00Z"), { detailed: false, showClosed: false })).toEqual({ text: "6 Oct 2026", urgent: false });
    expect(d(NO_ZONE, at("2026-10-01T12:00:00Z"), { detailed: true, showClosed: true })).toEqual({ text: "Closes 6 Oct 2026 — time zone not stated, apply a day early · 4 days left", urgent: true });
  });

  it("no deadline: null (the caller shows its own note)", async () => {
    const d = await display();
    expect(d({ application_deadline: null, close_time: null, close_tz: null }, at("2026-10-01T12:00:00Z"), { detailed: false, showClosed: false })).toBeNull();
  });
});

describe("the deadline-alert email states ABSOLUTE deadlines (an email is read hours after it is sent)", () => {
  it("with a zone: 'Closes 6 Oct 2026, 11:00 UTC'", async () => {
    const s = await get("scholarshipDeadlineStatement");
    expect(s({ application_deadline: "2026-10-06", close_time: "11:00", close_tz: "UTC" })).toBe("Closes 6 Oct 2026, 11:00 UTC");
    expect(s({ application_deadline: "2026-10-06", close_time: "13:00", close_tz: "America/Los_Angeles" })).toBe("Closes 6 Oct 2026, 13:00 (Pacific time)");
  });
  it("without one: 'Deadline 2 Oct 2026, time zone not stated. To be safe, apply by 1 Oct.'", async () => {
    const s = await get("scholarshipDeadlineStatement");
    expect(s({ application_deadline: "2026-10-02", close_time: null, close_tz: null })).toBe("Deadline 2 Oct 2026, time zone not stated. To be safe, apply by 1 Oct.");
  });
  it("across a month and a year boundary the apply-by day is the real day before", async () => {
    const s = await get("scholarshipDeadlineStatement");
    expect(s({ application_deadline: "2026-11-01", close_time: null, close_tz: null })).toBe("Deadline 1 Nov 2026, time zone not stated. To be safe, apply by 31 Oct.");
    expect(s({ application_deadline: "2027-01-01", close_time: null, close_tz: null })).toBe("Deadline 1 Jan 2027, time zone not stated. To be safe, apply by 31 Dec 2026.");
  });
  it("no deadline: null", async () => {
    const s = await get("scholarshipDeadlineStatement");
    expect(s({ application_deadline: null, close_time: null, close_tz: null })).toBeNull();
  });
});

describe("UTC is written as UTC", () => {
  it("'11:00 UTC', not '11:00 (GMT+00:00)'", async () => {
    const text = await get("scholarshipCloseText");
    expect(text({ application_deadline: "2026-10-06", close_time: "11:00", close_tz: "UTC" }, at("2026-10-02T08:30:00Z"))).toBe("Closes 6 Oct 2026, 11:00 UTC");
  });
  it("the other zones keep their generic names", async () => {
    const text = await get("scholarshipCloseText");
    expect(text({ application_deadline: "2026-10-06", close_time: "13:00", close_tz: "America/Los_Angeles" }, at("2026-10-02T08:30:00Z"))).toBe("Closes 6 Oct 2026, 13:00 (Pacific time)");
  });
  it("datetime.ts names UTC 'UTC' (and Etc/UTC, GMT-style spellings of it)", async () => {
    const { timeZoneGenericName } = await loadModule<{ timeZoneGenericName: (tz: string, at: Date) => string }>("@/lib/format/datetime");
    for (const tz of ["UTC", "Etc/UTC", "Etc/GMT", "GMT", "Zulu"]) expect(timeZoneGenericName(tz, at("2026-10-06T11:00:00Z")), tz).toBe("UTC");
    expect(timeZoneGenericName("America/Los_Angeles", at("2026-10-06T11:00:00Z"))).toBe("Pacific time");
  });
});
