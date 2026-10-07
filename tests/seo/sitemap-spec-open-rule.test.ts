/**
 * The sitemap e2e spec (e2e/seo-landing-pages-sitemap.spec.ts) must count "open scholarships" the way the APP does.
 *
 * The app: open until the closing INSTANT (`close_at > now`; a row with no zone closes at 12:00 UTC the NEXT day: migration 0204, src/lib/scholarships/close-instant.ts).
 * The spec used to count by DATE (`application_deadline >= today's UTC date`). For a scholarship whose deadline date was yesterday and that has no zone, the two disagree from 00:00 to 12:00 UTC:
 * the app still lists the landing page, the spec's baseline is one low, and the spec failed on every pull request run in that window (7 Oct 2026, Knight-Hennessy, PhD). This file:
 *   1. proves the disagreement with a fixed clock (no database, no waiting for the real hour), so the reason for the fix is on record and the window is exact;
 *   2. holds the spec to the app's own filter (`openScholarshipFilter`), and bans the date rule in every e2e spec, so it cannot come back.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isScholarshipOpen, openScholarshipFilter, scholarshipCloseInstant } from "@/lib/scholarships/close-instant";

const ROOT = path.resolve(__dirname, "../..");

/** The spec's old rule, verbatim in meaning: open when there is no deadline or the deadline DATE is today (UTC) or later. */
function openByDateRule(deadline: string | null, now: Date): boolean {
  return deadline === null || deadline >= now.toISOString().slice(0, 10);
}
const KNIGHT_HENNESSY = { application_deadline: "2026-10-06", close_tz: null, close_time: null }; // phd, no zone, in the seed catalogue

describe("the date rule and the app's rule disagree for a zone-less deadline that was yesterday", () => {
  const at = (iso: string) => new Date(iso);

  it("at 06:00Z on 7 Oct (the failing runs): the app says OPEN, the date rule says closed", () => {
    const now = at("2026-10-07T06:00:00Z");
    expect(isScholarshipOpen(KNIGHT_HENNESSY, now)).toBe(true);
    expect(openByDateRule(KNIGHT_HENNESSY.application_deadline, now)).toBe(false);
  });

  it("the window is exactly 00:00:00Z up to (not including) 12:00:00Z on the day after the deadline", () => {
    const hours = ["2026-10-06T23:59:59Z", "2026-10-07T00:00:00Z", "2026-10-07T06:00:00Z", "2026-10-07T11:59:59Z", "2026-10-07T12:00:00Z", "2026-10-07T18:00:00Z"];
    const disagree = hours.filter((h) => isScholarshipOpen(KNIGHT_HENNESSY, at(h)) !== openByDateRule(KNIGHT_HENNESSY.application_deadline, at(h)));
    expect(disagree).toEqual(["2026-10-07T00:00:00Z", "2026-10-07T06:00:00Z", "2026-10-07T11:59:59Z"]);
  });

  it("the closing instant of a zone-less deadline is 12:00Z the next day (the rule the window comes from)", () => {
    expect(scholarshipCloseInstant(KNIGHT_HENNESSY)?.toISOString()).toBe("2026-10-07T12:00:00.000Z");
  });

  it("a row with no deadline is open under both rules, and a deadline far ahead is open under both: only the half-day after a deadline differs", () => {
    const now = at("2026-10-07T06:00:00Z");
    expect(isScholarshipOpen({ application_deadline: null, close_tz: null, close_time: null }, now)).toBe(true);
    expect(openByDateRule(null, now)).toBe(true);
    expect(isScholarshipOpen({ application_deadline: "2099-12-31", close_tz: null, close_time: null }, now)).toBe(true);
    expect(openByDateRule("2099-12-31", now)).toBe(true);
  });

  it("the app's PostgREST filter is the same instant rule (the string the spec now uses)", () => {
    expect(openScholarshipFilter(at("2026-10-07T06:00:00Z"))).toBe("close_at.is.null,close_at.gt.2026-10-07T06:00:00.000Z");
  });
});

describe("the sitemap spec counts open scholarships with the app's own filter", () => {
  const spec = readFileSync(path.join(ROOT, "e2e/seo-landing-pages-sitemap.spec.ts"), "utf8");

  it("phdOpenCount() uses openScholarshipFilter(), imported from the app", () => {
    expect(spec).toMatch(/import \{[^}]*\bopenScholarshipFilter\b[^}]*\} from "\.\.\/src\/lib\/scholarships\/close-instant"/);
    expect(spec).toMatch(/\.or\(openScholarshipFilter\(\)\)/);
  });

  it("the spec no longer builds a date from the clock for that count", () => {
    expect(spec).not.toMatch(/const today = new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  });
});

describe("no e2e spec counts scholarships as open by the deadline DATE", () => {
  const specs = readdirSync(path.join(ROOT, "e2e")).filter((f) => /\.spec\.ts$/.test(f));

  it("the scan reads the real folder (many specs, including the sitemap one)", () => {
    expect(specs.length).toBeGreaterThan(50);
    expect(specs).toContain("seo-landing-pages-sitemap.spec.ts");
  });

  it.each(specs)("%s has no `application_deadline.gte` / `.is.null,application_deadline` open-rule filter", (file) => {
    const text = readFileSync(path.join(ROOT, "e2e", file), "utf8");
    expect(text).not.toMatch(/application_deadline\.gte/);
    expect(text).not.toMatch(/application_deadline\.is\.null,application_deadline/);
    expect(text).not.toMatch(/\.gte\(\s*["']application_deadline["']/);
  });
});
