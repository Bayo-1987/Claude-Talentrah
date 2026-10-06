/**
 * send-511 (owner's follow-up) — drop the "Deadline:" label wherever the sentence already carries the date.
 *
 * "Deadline: Last day: deadline 2 Oct 2026, time zone not stated. Apply now." says deadline three times. In the two states whose sentence stands
 * on its own (the "last day" statement, and "the date has passed in some time zones") the label is omitted and the sentence is shown alone. The card,
 * the detail page, the landing page and the blog embed all render the line through ONE component, so a rendered line can never carry both.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "../support/load-module";
import { readFileSync } from "node:fs";

interface Row {
  application_deadline: string | null;
  close_time: string | null;
  close_tz: string | null;
}
interface Display {
  text: string;
  urgent: boolean;
  labelled: boolean;
}
interface CloseMod {
  scholarshipDeadlineDisplay?: (row: Row, now: Date, opts: { detailed: boolean; showClosed: boolean }) => Display | null;
}
interface LineMod {
  DeadlineLine?: (props: { text: string; urgent: boolean; labelled: boolean; labelClassName?: string }) => unknown;
}

const NO_ZONE: Row = { application_deadline: "2026-10-06", close_time: null, close_tz: null };
const ZONED: Row = { application_deadline: "2026-10-06", close_time: "11:00", close_tz: "UTC" };
// Toronto is on daylight time on 6 Oct (UTC-4, so 11:00 is 15:00Z) and falls back on 1 Nov 2026, so "end of 1 Nov" is 05:00Z on 2 Nov (UTC-5): the 25-hour day.
const TORONTO: Row = { application_deadline: "2026-10-06", close_time: "11:00", close_tz: "America/Toronto" };
const TORONTO_FALL_BACK: Row = { application_deadline: "2026-11-01", close_time: null, close_tz: "America/Toronto" };
const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// Both modules are loaded once for the file (the old helper loaded and re-checked them on every call, thousands of times).
const modules = (async () => {
  const close = await loadModule<CloseMod>("@/lib/scholarships/close-instant");
  const lineMod = await loadModule<LineMod>("@/components/scholarships/deadline-line");
  expect(close.scholarshipDeadlineDisplay).toBeTypeOf("function");
  expect(lineMod.DeadlineLine, "DeadlineLine must be exported from src/components/scholarships/deadline-line.tsx").toBeTypeOf("function");
  return { display: close.scholarshipDeadlineDisplay!, Component: lineMod.DeadlineLine as (p: Display & { labelClassName?: string }) => React.ReactElement };
})();

const COMPACT = { detailed: false, showClosed: false };
const DETAILED = { detailed: true, showClosed: true };

async function line(row: Row, now: string | number, opts = COMPACT): Promise<string> {
  const { display, Component } = await modules;
  const d = display(row, new Date(now), opts)!;
  return textOf(renderToStaticMarkup(Component({ ...d })));
}

describe("which states drop the label", () => {
  it("the 'last day' statement is shown alone", async () => {
    expect(await line(NO_ZONE, "2026-10-06T05:00:00Z")).toBe("Last day: deadline 6 Oct 2026, time zone not stated. Apply now.");
  });

  it("'passed in some time zones' is shown alone, with the date it is about", async () => {
    expect(await line(NO_ZONE, "2026-10-06T23:30:00Z")).toBe("6 Oct 2026 · Deadline date has passed in some time zones. May already be closed.");
  });

  it("every other state keeps the label: days left, hours left, closed, zoned", async () => {
    expect(await line(NO_ZONE, "2026-10-01T12:00:00Z")).toBe("Deadline: 6 Oct 2026 · 4 days left");
    expect(await line(ZONED, "2026-10-06T05:00:00Z")).toBe("Deadline: 6 Oct 2026 · Closes in 6 hours");
    expect(await line(ZONED, "2026-10-02T08:30:00Z", { detailed: true, showClosed: true })).toBe("Deadline: Closes 6 Oct 2026, 11:00 UTC · 4 days left");
  });
});

/*
 * THE EDGES, by hand. The no-zone row (6 Oct 2026) moves through the states on the earliest-zone timeline (src/lib/scholarships/close-instant.ts, scholarshipCountdown):
 *   D 00:00 at UTC+14  = 2026-10-05T10:00Z  the date begins somewhere   ("N days left" before, "Last day: ..." from here)
 *   D 24:00 at UTC+14  = 2026-10-06T10:00Z  the date has ended there    ("Deadline date has passed in some time zones ..." from here)
 *   D+1 12:00 UTC      = 2026-10-07T12:00Z  the date has ended in UTC-12, the last place: closed from here
 * A row with a zone has one instant: "N days left" from 24 hours out, "Closes in N hours" under 24, "under an hour" under 1, closed AT the instant.
 * Each edge is checked one millisecond either side. (This replaces a sweep of 3,840 renders that took about 2.5 s alone; these edges take about 0.4 s.)
 */
const LAST_DAY = "Last day: deadline 6 Oct 2026, time zone not stated. Apply now.";
const PASSED = "6 Oct 2026 · Deadline date has passed in some time zones. May already be closed.";
const MS = { hour: 3_600_000, day: 86_400_000 };
const t = (iso: string, offsetMs = 0) => Date.parse(iso) + offsetMs;
const NZ_START = "2026-10-05T10:00:00Z";
const NZ_END = "2026-10-06T10:00:00Z";
const NZ_CLOSE = "2026-10-07T12:00:00Z";

describe("the edges of every state, one millisecond either side", () => {
  it.each([
    [NZ_START, -1, "Deadline: 6 Oct 2026 · 1 day left"],
    [NZ_START, 0, LAST_DAY],
    [NZ_END, -1, LAST_DAY],
    [NZ_END, 0, PASSED],
    [NZ_CLOSE, -1, PASSED],
    [NZ_CLOSE, 0, "Deadline: 6 Oct 2026"],
    ["2026-10-04T10:00:00Z", -1, "Deadline: 6 Oct 2026 · 2 days left"],
    ["2026-10-01T12:00:00Z", 0, "Deadline: 6 Oct 2026 · 4 days left"],
  ])("no zone, compact: %s %i ms", async (iso, off, expected) => {
    expect(await line(NO_ZONE, t(iso, off))).toBe(expected);
  });

  it.each([
    [NZ_START, -1, "Deadline: Closes 6 Oct 2026 — time zone not stated, apply a day early · 1 day left"],
    [NZ_START, 0, LAST_DAY],
    [NZ_END, 0, PASSED],
    [NZ_CLOSE, -1, PASSED],
  ])("no zone, detailed: %s %i ms", async (iso, off, expected) => {
    expect(await line(NO_ZONE, t(iso, off), DETAILED)).toBe(expected);
  });

  it("no zone, once it has closed everywhere: the 'Closed' suffix, with the label (the caution wording before it is not pinned here)", async () => {
    expect(await line(NO_ZONE, t(NZ_CLOSE), DETAILED)).toMatch(/^Deadline: .* · Closed$/);
    expect(await line(NO_ZONE, t(NZ_CLOSE, 1), DETAILED)).toMatch(/^Deadline: .* · Closed$/);
  });

  // The same six edges for a row with a zone, in three zones: UTC, Toronto on daylight time, and Toronto on the day the clocks fall back.
  it.each([
    ["UTC", ZONED, t("2026-10-06T11:00:00Z"), "6 Oct 2026", "Closes 6 Oct 2026, 11:00 UTC"],
    ["Toronto, daylight time (11:00 EDT = 15:00Z)", TORONTO, t("2026-10-06T15:00:00Z"), "6 Oct 2026", "Closes 6 Oct 2026, 11:00 (Eastern time)"],
    ["Toronto, the fall-back day (end of 1 Nov = 05:00Z on 2 Nov)", TORONTO_FALL_BACK, t("2026-11-02T05:00:00Z"), "1 Nov 2026", "Closes 1 Nov 2026, end of day (Eastern time)"],
  ])("%s", async (_name, row, close, date, closes) => {
    const edges: Array<[number, string]> = [
      [-2 * MS.day, "2 days left"],
      [-MS.day - 1, "1 day left"],
      [-MS.day, "1 day left"],
      [-MS.day + 1, "Closes in 23 hours"],
      [-MS.hour - 1, "Closes in 1 hour"],
      [-MS.hour, "Closes in 1 hour"],
      [-MS.hour + 1, "Closes in under an hour"],
      [-1, "Closes in under an hour"],
    ];
    for (const [off, phrase] of edges) {
      expect(await line(row, close + off), `${off} ms`).toBe(`Deadline: ${date} · ${phrase}`);
      expect(await line(row, close + off, DETAILED), `${off} ms, detailed`).toBe(`Deadline: ${closes} · ${phrase}`);
    }
    // At the instant it is closed (not "0 hours left"), and stays closed.
    for (const off of [0, 1, MS.day]) {
      expect(await line(row, close + off), `${off} ms`).toBe(`Deadline: ${date}`);
      expect(await line(row, close + off, DETAILED), `${off} ms, detailed`).toBe(`Deadline: ${closes} · Closed`);
    }
  });
});

describe("no rendered line says 'Deadline: Last day' or the word deadline twice", () => {
  it("every edge above, and every 3 hours from 5 days before each row's date to 3 days after, for all four rows in compact and detailed form", async () => {
    const offenders: string[] = [];
    const rows: Array<[Row, number]> = [
      [NO_ZONE, t("2026-10-06T00:00:00Z")],
      [ZONED, t("2026-10-06T00:00:00Z")],
      [TORONTO, t("2026-10-06T00:00:00Z")],
      [TORONTO_FALL_BACK, t("2026-11-01T00:00:00Z")],
    ];
    const instants = (day: number) => {
      const out: number[] = [];
      for (let m = -5 * 24 * 60; m <= 3 * 24 * 60; m += 180) out.push(day + m * 60_000);
      // plus the edges themselves and one millisecond either side (the 3-hour steps never land on them)
      for (const edge of [t(NZ_START), t(NZ_END), t(NZ_CLOSE), t("2026-10-06T11:00:00Z"), t("2026-10-06T15:00:00Z"), t("2026-11-02T05:00:00Z")]) {
        for (const d of [-MS.day, -MS.hour, -1, 0, 1]) out.push(edge + d);
      }
      return out;
    };
    for (const [row, day] of rows) {
      for (const now of instants(day)) {
        for (const opts of [COMPACT, DETAILED]) {
          const text = await line(row, now, opts);
          const count = (text.match(/deadline/gi) ?? []).length;
          if (text.includes("Deadline: Last day") || count > 1) offenders.push(`${new Date(now).toISOString()} ${JSON.stringify(row)} ${JSON.stringify(opts)} -> ${text}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("every surface renders through the one component", () => {
  it.each([
    "src/components/scholarships/scholarship-card.tsx",
    "src/app/(app)/scholarships/[id]/page.tsx",
    "src/components/scholarships/public-landing.tsx",
  ])("%s uses DeadlineLine and no longer hand-writes the 'Deadline:' label", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toContain("DeadlineLine");
    expect(src).not.toMatch(/>\s*Deadline:\s*<\/span>/);
  });

  it("the blog embed leaves the label off for the same two states", () => {
    const src = readFileSync("src/lib/blog/scholarship-embed.ts", "utf8");
    expect(src).toMatch(/labelled/);
  });
});
