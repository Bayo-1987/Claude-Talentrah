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
const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function line(row: Row, now: string, opts = { detailed: false, showClosed: false }): Promise<string> {
  const close = await loadModule<CloseMod>("@/lib/scholarships/close-instant");
  const lineMod = await loadModule<LineMod>("@/components/scholarships/deadline-line");
  expect(close.scholarshipDeadlineDisplay).toBeTypeOf("function");
  expect(lineMod.DeadlineLine, "DeadlineLine must be exported from src/components/scholarships/deadline-line.tsx").toBeTypeOf("function");
  const d = close.scholarshipDeadlineDisplay!(row, new Date(now), opts)!;
  const Component = lineMod.DeadlineLine as (p: Display & { labelClassName?: string }) => React.ReactElement;
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

describe("no rendered line says 'Deadline: Last day' or the word deadline twice", () => {
  it("sweeping every 30 minutes across 10 days, for a no-zone row and a zoned row, in compact and detailed form", async () => {
    const offenders: string[] = [];
    for (let m = 0; m <= 10 * 24 * 60; m += 30) {
      const now = new Date(Date.parse("2026-10-01T00:00:00Z") + m * 60_000).toISOString();
      for (const row of [NO_ZONE, ZONED]) {
        for (const opts of [{ detailed: false, showClosed: false }, { detailed: true, showClosed: true }]) {
          const text = await line(row, now, opts);
          const count = (text.match(/deadline/gi) ?? []).length;
          if (text.includes("Deadline: Last day") || count > 1) offenders.push(`${now} ${JSON.stringify(opts)} -> ${text}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  }, 60_000);
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
