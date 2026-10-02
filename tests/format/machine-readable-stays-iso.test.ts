/**
 * send-499 — the display formatter ("10 Sep 2026", "10:00 WAT") must never feed machine-readable output.
 *
 * A JSON-LD `datePublished`, a sitemap `lastmod`, an .ics DTSTART, a CSV cell, Paystack metadata or an email header read by a
 * machine must stay ISO 8601: "10 Sep 2026" is a different, wrong value to a crawler or a calendar. Display strings in the
 * body of an email are fine; those are for a person.
 *
 * The files are DISCOVERED by what they emit (a marker in the source), not listed by hand, so a new machine-readable module is
 * covered the day it exists. And the discovery is asserted non-empty and to include the known ones: an empty set would pass
 * this test for the wrong reason.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

/** What makes a file machine-readable output. Each pattern is something a program, not a person, reads. */
const MACHINE_MARKERS: Array<[string, RegExp]> = [
  ["iCalendar", /BEGIN:VCALENDAR|DTSTART/],
  ["sitemap lastModified", /lastModified\s*:/],
  ["JSON-LD", /"@context"|'@context'|@context:/],
  ["CSV", /text\/csv/],
  ["Paystack metadata", /initializeTransaction\s*\(/],
  ["JSON API response", /(NextResponse|Response)\.json\(/],
];

const FORMATTER_IMPORT = /from\s+["']@\/lib\/format\/datetime["']/;

const files = walk(SRC).map((f) => ({ path: relative(ROOT, f), source: readFileSync(f, "utf8") }));
const machine = files
  .filter((f) => f.path !== "src/lib/format/datetime.ts")
  .map((f) => ({ ...f, kinds: MACHINE_MARKERS.filter(([, re]) => re.test(f.source)).map(([k]) => k) }))
  .filter((f) => f.kinds.length > 0);

describe("machine-readable output stays ISO", () => {
  it("discovery is not vacuous: it finds the known machine-readable modules", () => {
    const found = new Set(machine.map((f) => f.path));
    expect(machine.length).toBeGreaterThan(5);
    for (const known of ["src/lib/mentorship/calendar-invite.ts", "src/app/sitemap.ts", "src/lib/seo/job-posting-jsonld.ts"]) {
      expect(found.has(known), `${known} should be discovered as machine-readable`).toBe(true);
    }
  });

  it("none of them imports the display formatter", () => {
    const offenders = machine.filter((f) => FORMATTER_IMPORT.test(f.source)).map((f) => `${f.path} (${f.kinds.join(", ")})`);
    expect(offenders, "machine-readable output must stay ISO: revert the display formatter here").toEqual([]);
  });
});
