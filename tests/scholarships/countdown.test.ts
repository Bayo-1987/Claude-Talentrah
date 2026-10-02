/**
 * send-511 — the countdown for a scholarship whose deadline has NO stated zone.
 *
 * 0204 keeps such a row LISTED until the last place on Earth has ended the day (12:00 UTC the next day). That rule is right for "does it
 * show", wrong for "how many days left": on 2 Oct itself the page said "1 day left" next to "apply a day early". The count must use the
 * stated DATE, in four states, all read off one timeline anchored on the EARLIEST zone (UTC+14, Kiritimati), where the date begins first and
 * ends first. For a deadline date D:
 *
 *   before the date has begun anywhere (now < D 00:00 at UTC+14)   "N days left", N = calendar days to D
 *   the date is current somewhere, not yet over in UTC+14         "Closes today: time zone not stated, apply now"
 *   over in UTC+14, not yet over in UTC-12 (= the 0204 instant)    "Deadline date has passed in some time zones. May already be closed"
 *   at or after the closing instant (D+1 12:00 UTC)                closed
 *
 * A row WITH a zone keeps the exact countdown it has: whole days to its closing instant.
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";

interface Row {
  application_deadline: string | null;
  close_time: string | null;
  close_tz: string | null;
}
interface Countdown {
  state: "none" | "days" | "today" | "passed-somewhere" | "closed";
  days: number | null;
  phrase: string | null;
  urgent: boolean;
}
interface Mod {
  scholarshipCountdown?: (row: Row, now: Date) => Countdown;
  scholarshipCloseText?: (row: Row, now?: Date) => string | null;
  isScholarshipOpen?: (row: Row, now: Date) => boolean;
}
const get = async <K extends keyof Mod>(k: K): Promise<NonNullable<Mod[K]>> => {
  const m = await loadModule<Mod>("@/lib/scholarships/close-instant");
  expect(m[k], `${String(k)} must be exported from src/lib/scholarships/close-instant.ts`).toBeTypeOf("function");
  return m[k] as NonNullable<Mod[K]>;
};

const NO_ZONE: Row = { application_deadline: "2026-10-06", close_time: null, close_tz: null };
const at = (iso: string) => new Date(iso);

const TODAY = "Closes today: time zone not stated, apply now";
const PASSED = "Deadline date has passed in some time zones. May already be closed";

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

  it("the moment the date begins in UTC+14 (5 Oct 10:00:00Z) until it ends there (6 Oct 09:59:59Z): 'Closes today, apply now'", async () => {
    const c = await get("scholarshipCountdown");
    expect(c(NO_ZONE, at("2026-10-05T10:00:00Z"))).toMatchObject({ state: "today", phrase: TODAY, urgent: true });
    expect(c(NO_ZONE, at("2026-10-06T00:00:00Z"))).toMatchObject({ state: "today", phrase: TODAY });
    expect(c(NO_ZONE, at("2026-10-06T09:59:59Z"))).toMatchObject({ state: "today", phrase: TODAY });
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
      expect(r.phrase, now).toBe(TODAY);
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

describe("a row WITH a zone keeps the exact countdown it has", () => {
  const toronto: Row = { application_deadline: "2026-10-06", close_time: "23:59", close_tz: "America/Toronto" }; // closes 7 Oct 03:59Z
  const chevening: Row = { application_deadline: "2026-10-06", close_time: "11:00", close_tz: "UTC" };

  it("on its deadline day the count is whole days to the instant, not the date-based states", async () => {
    const c = await get("scholarshipCountdown");
    // 6 Oct 12:00Z: 15h59m to go: 0 whole days. (A zone-less row at this moment would be 'passed in some time zones'.)
    expect(c(toronto, at("2026-10-06T12:00:00Z"))).toMatchObject({ state: "days", days: 0, phrase: "0 days left" });
    expect(c(toronto, at("2026-10-06T10:00:00Z")).state).toBe("days");
    expect(c(toronto, at("2026-10-05T03:59:01Z"))).toMatchObject({ state: "days", days: 1, phrase: "1 day left" });
  });

  it("2 Oct 08:30Z to Chevening's 6 Oct 11:00 UTC close is 4 days; the same row a minute before the instant is 0 days; at it, closed", async () => {
    const c = await get("scholarshipCountdown");
    expect(c(chevening, at("2026-10-02T08:30:00Z"))).toMatchObject({ state: "days", days: 4, phrase: "4 days left" });
    expect(c(chevening, at("2026-10-06T10:59:00Z"))).toMatchObject({ state: "days", days: 0 });
    expect(c(chevening, at("2026-10-06T11:00:00Z"))).toMatchObject({ state: "closed", phrase: "Closed" });
  });

  it("a zone with no time keeps its end-of-day instant and the same days arithmetic", async () => {
    const c = await get("scholarshipCountdown");
    const lagos: Row = { application_deadline: "2026-10-06", close_time: null, close_tz: "Africa/Lagos" }; // closes 6 Oct 23:00Z
    expect(c(lagos, at("2026-10-06T10:00:00Z"))).toMatchObject({ state: "days", days: 0 });
    expect(c(lagos, at("2026-10-06T23:00:00Z")).state).toBe("closed");
  });

  it("no deadline: no countdown at all", async () => {
    const c = await get("scholarshipCountdown");
    expect(c({ application_deadline: null, close_time: null, close_tz: null }, at("2026-10-06T10:00:00Z"))).toMatchObject({ state: "none", days: null, phrase: null, urgent: false });
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
