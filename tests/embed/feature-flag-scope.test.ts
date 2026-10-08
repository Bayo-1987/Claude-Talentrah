/**
 * Regression pin for the server-side switch (owner, 8 Oct 2026): with EMBED_WIDGET_ENABLED unset, NOTHING else in the product changes. The switch may be read in exactly four places and
 * nowhere else: the embed route, the settings action, the Company Profile page (which only passes it to the card as `available`) and the card's own early return keys off that prop.
 * A new reader of embedWidgetEnabled() (another page, a layout, a nav item, a job feed) fails here until it is decided on purpose.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[\s;{}(,])\/\/.*$/gm, "$1");
const files = walk(SRC).map((p) => ({ path: relative(ROOT, p).split("\\").join("/"), code: stripComments(readFileSync(p, "utf8")) }));

const READERS = [
  "src/app/embed/jobs/[orgId]/route.ts",
  "src/app/employer/profile/page.tsx",
  "src/lib/embed/feature.ts",
  "src/lib/employer/widget-actions.ts",
];

describe("embedWidgetEnabled is read in exactly the places the owner agreed", () => {
  it("scans the real tree (not a vacuous check)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.path === "src/lib/embed/feature.ts" && /export function embedWidgetEnabled/.test(f.code))).toBe(true);
  });

  it("no file outside the four mentions it", () => {
    const mentions = files.filter((f) => /\bembedWidgetEnabled\b|\bEMBED_WIDGET_ENABLED\b/.test(f.code)).map((f) => f.path).sort();
    expect(mentions).toEqual([...READERS].sort());
  });

  it("the Company Profile page reads it once, and only to hand it to the card as `available`", () => {
    const page = files.find((f) => f.path === "src/app/employer/profile/page.tsx")!.code;
    expect(page.match(/embedWidgetEnabled\(\)/g)).toHaveLength(1);
    expect(page).toMatch(/available=\{embedWidgetEnabled\(\)\}/);
    expect(page).toMatch(/\{widget && \(/);
  });

  it("the card is the only component that renders differently: it keys off its `available` prop and reads no environment itself", () => {
    const card = files.find((f) => f.path === "src/components/employer/job-widget-card.tsx")!.code;
    expect(card).toMatch(/if \(!available\) \{/);
    expect(card).not.toMatch(/process\.env/);
    expect(card).not.toMatch(/embedWidgetEnabled/);
  });

  it("no layout, navigation or feed file mentions the embed switch or the embed paths", () => {
    const nav = files.filter((f) => /layout\.tsx$|masthead|nav|jobs\/(page|feed)/i.test(f.path)).filter((f) => /embed\/jobs|EMBED_WIDGET/.test(f.code)).map((f) => f.path);
    expect(nav).toEqual([]);
  });
});
