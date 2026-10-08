/**
 * Farah (C): "Your next free message is available on Fri 9 Oct at 14:20" needs a weekday and an "at", which the app's one
 * formatter did not have, and tests/format/no-direct-locale-formatting.test.ts forbids formatting a date anywhere else. So the
 * formatter gains ONE helper, `formatWeekdayAtTime`, in the same style as the others: names written out (never asked of Intl),
 * 24-hour, no seconds, no year, and NO zone label (the time is in the viewer's own zone, so the label would add nothing).
 * `viewerTimeZone` reads the viewer's zone name, here because this module is the one place Intl is allowed.
 *
 * Reached through loadModule so the file compiles before the helper exists.
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";

interface Mod {
  formatWeekdayAtTime?: (v: Date | string | number | null | undefined, o?: { timeZone?: string }) => string;
  formatWeekdayAtTimeZoned?: (v: Date | string | number | null | undefined, o?: { timeZone?: string }) => string;
  zoneShortName?: (timeZone: string, at: Date) => string;
  viewerTimeZone?: () => string | undefined;
}
async function fn<K extends keyof Mod>(name: K): Promise<NonNullable<Mod[K]>> {
  const m = await loadModule<Mod>("@/lib/format/datetime");
  const f = m[name];
  if (!f) throw new Error(`datetime.ts does not export ${String(name)}`);
  return f as NonNullable<Mod[K]>;
}

// 9 Oct 2026 is a Friday. 13:20 UTC is 14:20 in Lagos (UTC+1, no daylight saving) and 09:20 in Toronto (UTC-4 in October).
const INSTANT = "2026-10-09T13:20:00.000Z";

describe("formatWeekdayAtTime", () => {
  it("writes the weekday, day, month and 24-hour time in the named zone", async () => {
    const f = await fn("formatWeekdayAtTime");
    expect(f(INSTANT, { timeZone: "Africa/Lagos" })).toBe("Fri 9 Oct at 14:20");
    expect(f(INSTANT, { timeZone: "America/Toronto" })).toBe("Fri 9 Oct at 09:20");
  });

  it("the weekday and the day follow the zone, not the instant: late evening in Lagos is still Friday in Toronto", async () => {
    const f = await fn("formatWeekdayAtTime");
    const late = "2026-10-09T23:30:00.000Z"; // Sat 10 Oct 00:30 in Lagos, Fri 9 Oct 19:30 in Toronto
    expect(f(late, { timeZone: "Africa/Lagos" })).toBe("Sat 10 Oct at 00:30");
    expect(f(late, { timeZone: "America/Toronto" })).toBe("Fri 9 Oct at 19:30");
  });

  it("has no zone label, no seconds and no year", async () => {
    const f = await fn("formatWeekdayAtTime");
    const text = f("2026-10-09T13:20:45.000Z", { timeZone: "Africa/Lagos" });
    expect(text).toBe("Fri 9 Oct at 14:20");
    expect(text).not.toMatch(/WAT|GMT|UTC|:45|2026/);
  });

  it("accepts a Date and epoch milliseconds, and is the same instant either way", async () => {
    const f = await fn("formatWeekdayAtTime");
    expect(f(new Date(INSTANT), { timeZone: "Africa/Lagos" })).toBe("Fri 9 Oct at 14:20");
    expect(f(Date.parse(INSTANT), { timeZone: "Africa/Lagos" })).toBe("Fri 9 Oct at 14:20");
  });

  it("falls back to WAT for an unusable zone name instead of throwing", async () => {
    const f = await fn("formatWeekdayAtTime");
    expect(f(INSTANT, { timeZone: "Not/AZone" })).toBe("Fri 9 Oct at 14:20");
    expect(f(INSTANT)).toBe("Fri 9 Oct at 14:20");
  });

  it("gives '' for nothing usable: null, undefined, an unparseable string, and a bare calendar date (it has no time)", async () => {
    const f = await fn("formatWeekdayAtTime");
    expect(f(null)).toBe("");
    expect(f(undefined)).toBe("");
    expect(f("not a date")).toBe("");
    expect(f("2026-10-09")).toBe("");
  });

  it("covers every weekday with its own name (Mon 5 Oct to Sun 11 Oct 2026, noon UTC, Lagos)", async () => {
    const f = await fn("formatWeekdayAtTime");
    const days = ["Mon 5", "Tue 6", "Wed 7", "Thu 8", "Fri 9", "Sat 10", "Sun 11"];
    days.forEach((label, i) => {
      expect(f(`2026-10-${String(5 + i).padStart(2, "0")}T12:00:00.000Z`, { timeZone: "Africa/Lagos" })).toBe(`${label} Oct at 13:00`);
    });
  });
});

describe("viewerTimeZone", () => {
  it("returns a zone name the runtime accepts, or undefined; never throws", async () => {
    const z = await fn("viewerTimeZone");
    const name = z();
    if (name !== undefined) expect(() => new Intl.DateTimeFormat("en-US", { timeZone: name })).not.toThrow();
  });
});

describe("formatWeekdayAtTimeZoned (the same text, then the zone's own name)", () => {
  it("adds the name of the zone it formatted in, taken from the zone and not typed in", async () => {
    const f = await fn("formatWeekdayAtTimeZoned");
    expect(f(INSTANT, { timeZone: "Africa/Lagos" })).toBe("Fri 9 Oct at 14:20 WAT");
    expect(f(INSTANT, { timeZone: "America/Toronto" })).toBe("Fri 9 Oct at 09:20 EDT");
    expect(f(INSTANT, { timeZone: "UTC" })).toBe("Fri 9 Oct at 13:20 UTC");
  });
  it("an unusable zone falls back to the same default zone as formatWeekdayAtTime, and names THAT zone", async () => {
    const f = await fn("formatWeekdayAtTimeZoned");
    expect(f(INSTANT, { timeZone: "Not/AZone" })).toBe("Fri 9 Oct at 14:20 WAT");
    expect(f(INSTANT)).toBe("Fri 9 Oct at 14:20 WAT");
  });
  it("nothing for a value that is not an instant", async () => {
    const f = await fn("formatWeekdayAtTimeZoned");
    expect(f("2026-10-09")).toBe("");
    expect(f(null)).toBe("");
  });
});

describe("zoneShortName: the zone's own short name in a regional English locale, a clean fallback where there is only an offset", () => {
  const SUMMER = new Date("2026-07-11T05:01:00.000Z");
  const WINTER = new Date("2026-01-11T05:01:00.000Z");
  it.each([
    ["Africa/Lagos", SUMMER, "WAT"],
    ["Africa/Nairobi", SUMMER, "EAT"],
    ["Africa/Johannesburg", SUMMER, "SAST"],
    ["Africa/Accra", SUMMER, "GMT"],
    ["Europe/London", SUMMER, "BST"],
    ["Europe/London", WINTER, "GMT"],
    ["America/New_York", SUMMER, "EDT"],
    ["America/New_York", WINTER, "EST"],
    ["UTC", SUMMER, "UTC"],
  ])("%s reads %s", async (zone, at, expected) => {
    const f = await fn("zoneShortName");
    expect(f(zone, at)).toBe(expected);
  });
  it("Asia/Kathmandu has only an offset in a short name (GMT+5:45), so it falls back to the long generic name", async () => {
    const f = await fn("zoneShortName");
    expect(f("Asia/Kathmandu", SUMMER)).toBe("Nepal time");
  });
  it("a date across a daylight-saving change gets the name in force AT THAT INSTANT (London: BST on 25 Oct 00:30Z, GMT on 25 Oct 02:00Z)", async () => {
    const f = await fn("zoneShortName");
    expect(f("Europe/London", new Date("2026-10-25T00:30:00.000Z"))).toBe("BST");
    expect(f("Europe/London", new Date("2026-10-25T02:00:00.000Z"))).toBe("GMT");
    const z = await fn("formatWeekdayAtTimeZoned");
    expect(z("2026-10-25T00:30:00.000Z", { timeZone: "Europe/London" })).toBe("Sun 25 Oct at 01:30 BST");
    expect(z("2026-10-25T02:00:00.000Z", { timeZone: "Europe/London" })).toBe("Sun 25 Oct at 02:00 GMT");
  });
  it("never answers with a bare offset such as GMT+1 or UTC+5:45", async () => {
    const f = await fn("zoneShortName");
    for (const zone of ["Africa/Lagos", "Asia/Kathmandu", "Asia/Dubai", "Asia/Kolkata", "Australia/Sydney", "America/Sao_Paulo", "Pacific/Auckland"]) {
      expect(f(zone, SUMMER), zone).not.toMatch(/^(GMT|UTC)[+\-−]\d/);
    }
  });
});
