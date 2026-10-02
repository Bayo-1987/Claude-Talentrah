/**
 * send-509 / S3-21c — a post title that carries a date that has passed gets flagged.
 *
 * Two published posts went stale within days: "The Trudeau Foundation Doctoral Scholarship's First Deadline Is 2 October 2026" and
 * "Chevening Scholarships 2027: The Deadline Is 6 October 2026". The rule (owner's call): no hard dates in titles for content that outlives
 * the date, and a CHECK that flags one. This is the check: pure, tested at the day boundary, and shown on /admin/blog.
 *
 * "Passed" means the date's calendar day is over, in UTC: on the day itself it is today, not yet passed. A date written WITHOUT a year is
 * judged against the current year only (a title cannot tell us which October it meant), which is why the real rule is "no hard dates".
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";

interface Mod {
  staleDatesInTitle?: (title: string, now: Date) => string[];
}
const find = async (title: string, now: string): Promise<string[]> => {
  const m = await loadModule<Mod>("@/lib/blog/stale-title");
  expect(m.staleDatesInTitle, "staleDatesInTitle must be exported from src/lib/blog/stale-title.ts").toBeTypeOf("function");
  return m.staleDatesInTitle!(title, new Date(now));
};

const TRUDEAU = "The Trudeau Foundation Doctoral Scholarship's First Deadline Is 2 October 2026 — and It's Not the Last One";
const CHEVENING = "Chevening Scholarships 2027: The Deadline Is 6 October 2026";

describe("the two titles that went stale", () => {
  it("Trudeau: flagged once 2 October has passed, not before", async () => {
    expect(await find(TRUDEAU, "2026-10-01T12:00:00Z")).toEqual([]);
    expect(await find(TRUDEAU, "2026-10-03T00:00:01Z")).toEqual(["2 October 2026"]);
  });

  it("Chevening: flagged after 6 October; the bare year 2027 is not a date", async () => {
    expect(await find(CHEVENING, "2026-10-06T23:59:59Z")).toEqual([]);
    expect(await find(CHEVENING, "2026-10-07T00:00:00Z")).toEqual(["6 October 2026"]);
  });
});

describe("the day boundary (UTC): the day itself is not yet passed", () => {
  it.each([
    ["2 October 2026", "2026-10-02T23:59:59Z", false],
    ["2 October 2026", "2026-10-03T00:00:00Z", true],
  ])("%s at %s -> passed=%s", async (text, now, passed) => {
    expect((await find(`Deadline ${text}`, now)).length > 0).toBe(passed);
  });
});

describe("the date shapes a title can use", () => {
  const NOW = "2026-11-15T09:00:00Z";
  it.each([
    ["Closes 2 October 2026", "2 October 2026"],
    ["Closes 2nd October 2026", "2nd October 2026"],
    ["Closes October 2, 2026", "October 2, 2026"],
    ["Closes Oct 2 2026", "Oct 2 2026"],
    ["Closes 2 Oct 2026", "2 Oct 2026"],
    ["Closes 2 Oct, 2026", "2 Oct, 2026"],
    ["Closes 2026-10-02", "2026-10-02"],
    ["Closes 6 Oct", "6 Oct"],
    ["Closes October 6", "October 6"],
    ["Open until October 2026", "October 2026"],
  ])("%s", async (title, expected) => {
    expect(await find(title, NOW)).toEqual([expected]);
  });

  it("a month-only date is passed only after the month has ended", async () => {
    expect(await find("Open until October 2026", "2026-10-31T23:59:59Z")).toEqual([]);
    expect(await find("Open until October 2026", "2026-11-01T00:00:00Z")).toEqual(["October 2026"]);
  });

  it("a date written without a year is judged against the CURRENT year", async () => {
    expect(await find("Closes 6 Oct", "2026-09-20T00:00:00Z"), "still ahead this year").toEqual([]);
    expect(await find("Closes 6 Oct", "2026-10-07T00:00:00Z"), "passed this year").toEqual(["6 Oct"]);
  });

  it("returns every passed date, and skips the ones still ahead", async () => {
    expect(await find("Round one 2 Oct 2026, round two 9 Dec 2026", "2026-11-15T00:00:00Z")).toEqual(["2 Oct 2026"]);
  });
});

describe("things that are NOT dates stay unflagged", () => {
  it.each([
    "Top 10 scholarships for 2027",
    "Phase 2 of 3: the interview",
    "The Class of 2027–2028 cohort",
    "Chevening Scholarships 2027",
    "May I apply for more than one scholarship?",
    "Is 2 enough? Why you should apply to 10",
    "How to read your Match Score (and actually use it)",
    "What's a Good ATS Score?",
  ])("%s", async (title) => {
    expect(await find(title, "2030-01-01T00:00:00Z")).toEqual([]);
  });

  it("an impossible date (30 February) is not a date", async () => {
    expect(await find("Closes 30 February 2026", "2030-01-01T00:00:00Z")).toEqual([]);
  });

  it("an empty title is fine", async () => {
    expect(await find("", "2030-01-01T00:00:00Z")).toEqual([]);
  });
});
