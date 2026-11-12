/**
 * P5 (JOBS-POLISH-1): when a card or job page may say "Closes <date>", how the date reads, and when it also says "Closing soon".
 *
 * A date is shown ONLY where job_postings.expires_at_source (0278) is 'stated'. 'default' is the 30 days we apply when nobody gave a date, and NULL is unknown (production: 1,444 rows): both say nothing.
 * Dates are Africa/Lagos calendar days (UTC+1, no daylight saving), so a deadline of 23:00Z is the NEXT day in Lagos. "Closing soon" is 7 Lagos days or fewer, today included; a date already past says nothing.
 */
import { describe, expect, it } from "vitest";
import { CLOSING_SOON_DAYS, closingNotice, statedClosesAt } from "@/lib/jobs/closing-date";

const stated = (expires_at: string | null) => ({ expires_at, expires_at_source: "stated" as const });
const NOW = new Date("2026-11-10T08:00:00Z"); // 09:00 on 10 Nov in Lagos

describe("statedClosesAt: only a stated date is a date", () => {
  it("POSITIVE CONTROL: a stated, valid date is returned", () => {
    expect(statedClosesAt(stated("2026-11-20T22:59:59Z"))?.toISOString()).toBe("2026-11-20T22:59:59.000Z");
  });
  it("a 'default' date, an unknown (null) source and an absent source are not shown, whatever the date is", () => {
    expect(statedClosesAt({ expires_at: "2026-11-20T22:59:59Z", expires_at_source: "default" })).toBeNull();
    expect(statedClosesAt({ expires_at: "2026-11-20T22:59:59Z", expires_at_source: null })).toBeNull();
    expect(statedClosesAt({ expires_at: "2026-11-20T22:59:59Z" })).toBeNull();
    expect(statedClosesAt({ expires_at: "2026-11-20T22:59:59Z", expires_at_source: "Stated" })).toBeNull();
  });
  it("a stated source with no date, or a date nobody can read, is not shown", () => {
    expect(statedClosesAt(stated(null))).toBeNull();
    expect(statedClosesAt(stated("not a date"))).toBeNull();
    expect(statedClosesAt(stated(""))).toBeNull();
  });
});

describe("closingNotice: the label", () => {
  it("reads 'Closes 10 Nov 2026', day first, a three-letter month, no leading zero", () => {
    expect(closingNotice(stated("2026-11-10T12:00:00Z"), NOW)?.label).toBe("Closes 10 Nov 2026");
    expect(closingNotice(stated("2026-12-05T12:00:00Z"), NOW)?.label).toBe("Closes 5 Dec 2026");
  });
  it("every month is spelt the same way whatever the machine's locale data says (September is Sep)", () => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    months.forEach((m, i) => {
      const iso = new Date(Date.UTC(2027, i, 15, 12)).toISOString();
      expect(closingNotice(stated(iso), new Date(Date.UTC(2027, i, 1, 12)))?.label).toBe(`Closes 15 ${m} 2027`);
    });
  });
  it("is the Lagos day: 23:00Z is already the next day in Lagos, 22:59:59Z is not", () => {
    expect(closingNotice(stated("2026-11-19T23:00:00Z"), NOW)?.label).toBe("Closes 20 Nov 2026");
    expect(closingNotice(stated("2026-11-19T22:59:59Z"), NOW)?.label).toBe("Closes 19 Nov 2026");
  });
  it("the importer's deadlines (the END of the stated day in Lagos, 22:59:59Z) read as that day", () => {
    expect(closingNotice(stated("2026-11-10T22:59:59Z"), NOW)?.label).toBe("Closes 10 Nov 2026");
  });
  it("is not shown for a default, unknown or past date", () => {
    expect(closingNotice({ expires_at: "2026-11-20T12:00:00Z", expires_at_source: "default" }, NOW)).toBeNull();
    expect(closingNotice({ expires_at: "2026-11-20T12:00:00Z", expires_at_source: null }, NOW)).toBeNull();
    expect(closingNotice(stated("2026-11-09T12:00:00Z"), NOW)).toBeNull();
  });
});

describe("closingNotice: 'Closing soon' at 7 days or fewer", () => {
  it("the threshold is 7", () => {
    expect(CLOSING_SOON_DAYS).toBe(7);
  });
  it("closing today is soon; 7 days away is soon; 8 days away is not", () => {
    expect(closingNotice(stated("2026-11-10T22:59:59Z"), NOW)?.soon).toBe(true);
    expect(closingNotice(stated("2026-11-17T12:00:00Z"), NOW)?.soon).toBe(true);
    expect(closingNotice(stated("2026-11-18T12:00:00Z"), NOW)?.soon).toBe(false);
  });
  it("counts Lagos calendar days, not 24-hour spans: the same instant is 8 days out at 22:59:59Z and 7 days out at 23:00:00Z", () => {
    const closes = stated("2026-11-17T12:00:00Z"); // 17 Nov in Lagos
    expect(closingNotice(closes, new Date("2026-11-09T22:59:59Z"))?.soon).toBe(false); // 9 Nov 23:59:59 Lagos: 8 days
    expect(closingNotice(closes, new Date("2026-11-09T23:00:00Z"))?.soon).toBe(true); // 10 Nov 00:00:00 Lagos: 7 days
  });
  it("a deadline just past Lagos midnight is the next day for this too", () => {
    expect(closingNotice(stated("2026-11-16T23:00:00Z"), NOW)?.soon).toBe(true); // 17 Nov Lagos: 7 days
    expect(closingNotice(stated("2026-11-17T23:00:00Z"), NOW)?.soon).toBe(false); // 18 Nov Lagos: 8 days
  });
});
