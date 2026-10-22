import { describe, expect, it } from "vitest";
import { hourInZone } from "@/lib/format/datetime";

/**
 * hourInZone(timeZone, at): the hour of the day, 0 to 23, at an instant in a named zone. It exists so the notifications fake can ask "what hour is it for this device" without calling
 * Intl.DateTimeFormat itself (tests/format/no-direct-locale-formatting.test.ts allows that only in this module).
 */
const at = (iso: string) => new Date(iso);

describe("hourInZone: the hour at an instant", () => {
  it.each([
    ["Africa/Lagos", "2026-10-26T20:59:59Z", 21],
    ["Africa/Lagos", "2026-10-26T21:00:00Z", 22],
    ["Africa/Lagos", "2026-10-26T23:00:00Z", 0],
    ["Asia/Kolkata", "2026-10-26T16:29:59Z", 21],
    ["Asia/Kolkata", "2026-10-26T16:30:00Z", 22],
    ["Asia/Kathmandu", "2026-10-26T00:00:00Z", 5],
    ["UTC", "2026-10-26T23:59:59Z", 23],
    ["UTC", "2026-10-27T00:00:00Z", 0],
    ["Pacific/Kiritimati", "2026-10-26T10:00:00Z", 0],
    ["Pacific/Pago_Pago", "2026-10-26T10:00:00Z", 23],
  ])("%s at %s is hour %i", (zone, iso, hour) => {
    expect(hourInZone(zone, at(iso))).toBe(hour);
  });

  it("follows daylight saving in both directions (America/Los_Angeles)", () => {
    // clocks go back at 09:00Z on 2026-11-01
    expect(hourInZone("America/Los_Angeles", at("2026-11-01T08:59:59Z"))).toBe(1);
    expect(hourInZone("America/Los_Angeles", at("2026-11-01T09:00:00Z"))).toBe(1);
    expect(hourInZone("America/Los_Angeles", at("2026-11-01T14:00:00Z"))).toBe(6);
    expect(hourInZone("America/Los_Angeles", at("2026-11-01T15:00:00Z"))).toBe(7);
    // clocks go forward at 10:00Z on 2026-03-08
    expect(hourInZone("America/Los_Angeles", at("2026-03-08T09:59:59Z"))).toBe(1);
    expect(hourInZone("America/Los_Angeles", at("2026-03-08T10:00:00Z"))).toBe(3);
    expect(hourInZone("America/Los_Angeles", at("2026-03-08T13:59:59Z"))).toBe(6);
    expect(hourInZone("America/Los_Angeles", at("2026-03-08T14:00:00Z"))).toBe(7);
  });

  it("an instant before 1970 and a fractional millisecond still give a whole hour from 0 to 23", () => {
    expect(hourInZone("UTC", new Date(-1))).toBe(23);
    expect(hourInZone("UTC", new Date(1.9))).toBe(0);
    expect(hourInZone("Africa/Lagos", new Date(-3_600_000))).toBe(0);
  });

  it("a name the runtime does not know throws a RangeError (it is never read as UTC)", () => {
    expect(() => hourInZone("Mars/Olympus", at("2026-10-26T12:00:00Z"))).toThrow(RangeError);
  });

  it("an invalid Date throws rather than answering with a made-up hour", () => {
    expect(() => hourInZone("UTC", new Date(Number.NaN))).toThrow();
  });

  it("agrees with an independent Intl computation (the method the fake used before) for 8 zones over 2 years, every 6 hours 37 minutes", () => {
    const zones = ["Africa/Lagos", "Asia/Kolkata", "Asia/Kathmandu", "America/Los_Angeles", "Europe/London", "Australia/Lord_Howe", "Pacific/Chatham", "UTC"];
    const start = Date.UTC(2026, 0, 1);
    const end = Date.UTC(2027, 11, 31);
    const step = (6 * 60 + 37) * 60_000;
    let compared = 0;
    for (const zone of zones) {
      const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "numeric", hourCycle: "h23" });
      for (let t = start; t < end; t += step) {
        const expected = Number(formatter.formatToParts(new Date(t)).find((p) => p.type === "hour")?.value);
        const got = hourInZone(zone, new Date(t));
        if (got !== expected) throw new Error(`${zone} at ${new Date(t).toISOString()}: hourInZone=${got}, Intl=${expected}`);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(20_000);
  });
});
