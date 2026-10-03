/**
 * "How match scores work": ONE explainer, linked once per page (not on every card), saying what is counted, what is not
 * yet, and what "thin" means. It replaces the Industry-alignment placeholder cell that repeated on every card
 * (S3-23a; docs/match-confidence-invariant.md).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const LINK = /href="\/how-match-scores-work"/g;

describe("the link", () => {
  it("is on the feed page exactly once, beside the tabs", () => {
    expect(count(read("src/app/(app)/jobs/(feed)/page.tsx"), LINK)).toBe(1);
  });

  it("is on the job detail page exactly once", () => {
    expect(count(read("src/app/(app)/jobs/[id]/page.tsx"), LINK)).toBe(1);
  });

  it("is NOT on the card, which renders many times per page", () => {
    expect(count(read("src/components/jobs/job-card.tsx"), LINK)).toBe(0);
  });
});

describe("the explainer page", () => {
  const PAGE = "src/app/how-match-scores-work/page.tsx";

  it("exists", () => {
    expect(existsSync(path.join(process.cwd(), PAGE))).toBe(true);
  });

  it("says what is counted (skill tags and seniority), what is not yet (industry), and what thin means", () => {
    const src = read(PAGE).toLowerCase();
    expect(src).toMatch(/skill tags?/);
    expect(src).toMatch(/seniority/);
    expect(src).toMatch(/industry/);
    expect(src).toMatch(/thin/);
  });

  it("says an unstated seniority is NEUTRAL, not a penalty", () => {
    const text = read(PAGE).replace(/\{" "\}|<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toMatch(/seniority is neutral/i);
    expect(text).toMatch(/neither adds to the score nor takes anything away/i);
  });

  it("uses the three real tiers by name only (Excellent, Good, Fair), never a fourth", () => {
    const src = read(PAGE);
    expect(src).toMatch(/Excellent/);
    expect(src).toMatch(/Good/);
    expect(src).toMatch(/Fair/);
  });
});
