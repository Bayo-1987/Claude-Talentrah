/**
 * A scan that fails if anything renders a money range with identical bounds ("from ₦X to ₦X", "$X – $X"), S1-26 item 8.
 *
 * Two halves, because the bug has two ways back in. (1) RENDER every place a range is shown with equal bounds, in several
 * currencies, and look for the same amount on both sides of a "to" or a dash. (2) SCAN the source for a range built by hand
 * (two formatted amounts joined by "to" or a dash), which is how the original bug was written: a second place to forget the
 * equal-bounds case. Every range goes through src/lib/format-money-range.ts.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { MentorshipPublicLanding } from "@/components/mentorship/public-landing";
import { formatSalary } from "@/lib/jobs/format-salary";
import { formatMoneyRange } from "@/lib/format-money-range";

vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => <a href={p.href}>{p.children as never}</a> }));

/** Every "AMOUNT to AMOUNT" / "AMOUNT – AMOUNT" in `text` whose two amounts are the same figure (any currency prefix, any space). */
export function identicalRanges(text: string): string[] {
  const amount = String.raw`((?:[A-Z]{2,3}\$?|[₦$€£])?\s?(\d(?:[\d,.]*\d)?))`;
  const re = new RegExp(`${amount}\\s*(?:to|–|—|-)\\s*${amount}`, "g");
  return [...text.replace(/ /g, " ").matchAll(re)].filter((m) => m[2] === m[4]).map((m) => m[0]);
}

describe("the detector itself", () => {
  it("catches the original bug and its spellings, and leaves honest ranges alone", () => {
    expect(identicalRanges("sessions range from ₦20,000 to ₦20,000, depending")).toEqual(["₦20,000 to ₦20,000"]);
    expect(identicalRanges("US$90,000 – US$90,000 per year")).toHaveLength(1);
    expect(identicalRanges("GHS 90,000 to GHS 90,000")).toHaveLength(1);
    expect(identicalRanges("from ₦15,000 to ₦20,000")).toEqual([]);
    expect(identicalRanges("₦200,000 – ₦300,000 per month")).toEqual([]);
  });
});

describe("rendered, with equal bounds", () => {
  it("/mentorship's Pricing paragraph", () => {
    const html = renderToStaticMarkup(<MentorshipPublicLanding priceRangeNgn={{ minNgn: 20000, maxNgn: 20000 }} offersFreeSessions={false} />);
    expect(identicalRanges(html.replace(/<[^>]+>/g, ""))).toEqual([]);
  });

  it.each(["NGN", "USD", "EUR", "GBP", "GHS", "KES", "ZAR", "CAD"])("a job salary in %s", (salary_currency) => {
    for (const salary_unit of [null, "month", "year"] as const) {
      const line = formatSalary({ salary_min: 200000, salary_max: 200000, salary_currency, salary_unit });
      expect(identicalRanges(line ?? ""), `${salary_currency} ${salary_unit}: ${line}`).toEqual([]);
    }
  });

  it.each(["NGN", "USD", "EUR"])("formatMoneyRange itself, both styles, in %s", (currency) => {
    for (const style of ["words", "compact"] as const) expect(identicalRanges(formatMoneyRange(5000, 5000, currency, { style })!)).toEqual([]);
  });
});

describe("source: no range is built by hand", () => {
  const root = path.resolve(__dirname, "../..");
  const walk = (dir: string): string[] =>
    readdirSync(path.join(root, dir)).flatMap((name) => {
      const rel = `${dir}/${name}`;
      return statSync(path.join(root, rel)).isDirectory() ? walk(rel) : /\.tsx?$/.test(name) ? [rel] : [];
    });
  const files = walk("src");

  it("sees the tree (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("src/lib/format-money-range.ts");
  });

  it("no file outside the helper joins two formatted amounts with 'to' or a dash", () => {
    // two interpolated or formatted amounts around a joiner: `${fmt(a)} to ${fmt(b)}`, `₦${a} – ₦${b}`, `${a.toLocaleString()} to ${b.toLocaleString()}`
    const amountThenJoiner = /(?:₦|\$|€|£)?\$\{[^}]*\}\s*(?:to|–|—)\s*(?:₦|\$|€|£)?\$\{[^}]*(?:toLocaleString|format|naira|money)/;
    const hand = /(?:₦|\$|€|£)\$\{[^}]*\}\s*(?:to|–|—)\s*(?:₦|\$|€|£)\$\{/;
    const offenders: string[] = [];
    for (const f of files) {
      if (f === "src/lib/format-money-range.ts") continue;
      readFileSync(path.join(root, f), "utf8").split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (amountThenJoiner.test(line) || hand.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(offenders, "build a money range with formatMoneyRange (src/lib/format-money-range.ts), which collapses equal bounds").toEqual([]);
  });
});
