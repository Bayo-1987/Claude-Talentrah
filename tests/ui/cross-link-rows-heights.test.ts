/**
 * QA-3: the seven public pages' cross-link rows ("Also browsing:" on five landing pages, "Explore more:" on the job and scholarship detail pages) are standalone links, so each is
 * at least 24px tall (the owner's rule; WCAG 2.2 AA 2.5.8). They sit in a flex row with a 12px gap and render as bare inline anchors, about 18px tall, which is why QA's measure of
 * the link rows found them short. tests/ui/secondary-link-heights.test.tsx pins the same rule for the other offenders; this file is its companion for these seven, scanning the
 * source because each page is a server component that reads the database. The browser measure is e2e/secondary-link-heights.spec.ts (it needs a seeded landing page).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\s+/g, " ");

const PAGES: Array<{ file: string; label: string; links: string }> = [
  { file: "src/app/(app)/scholarships/fully-funded/page.tsx", label: "Also browsing:", links: "relatedLinks.map" },
  { file: "src/app/(app)/scholarships/degree/[level]/page.tsx", label: "Also browsing:", links: "relatedLinks.map" },
  { file: "src/app/(app)/jobs/remote/page.tsx", label: "Also browsing:", links: "relatedLinks.map" },
  { file: "src/app/(app)/jobs/remote/[country]/page.tsx", label: "Also browsing:", links: "relatedLinks.map" },
  { file: "src/app/(app)/jobs/in/[city]/page.tsx", label: "Also browsing:", links: "relatedLinks.map" },
  { file: "src/app/(app)/scholarships/[id]/page.tsx", label: "Explore more:", links: "landingLinks.map" },
  { file: "src/app/(app)/jobs/[id]/page.tsx", label: "Explore more:", links: "landingLinks.map" },
];

/** The minimum height, in px, a class list guarantees (Tailwind's min-h-N is N*4px, min-h-[Npx] is N), or 0. */
function minHeightPx(classes: string): number {
  let best = 0;
  for (const c of classes.split(/\s+/)) {
    const scale = /^min-h-(\d+(?:\.\d+)?)$/.exec(c);
    if (scale) best = Math.max(best, Number(scale[1]) * 4);
    const arbitrary = /^min-h-\[(\d+(?:\.\d+)?)px\]$/.exec(c);
    if (arbitrary) best = Math.max(best, Number(arbitrary[1]));
  }
  return best;
}

describe("cross-link rows: every link is a standalone target of at least 24px", () => {
  for (const { file, label, links } of PAGES) {
    it(`${file}: the "${label}" links`, () => {
      const src = read(file);
      const at = src.indexOf(label);
      expect(at, `no "${label}" row in ${file}`).toBeGreaterThan(-1);
      const mapAt = src.indexOf(links, at);
      expect(mapAt, `no ${links} after the label in ${file}`).toBeGreaterThan(-1);
      const link = /<Link\b[^>]*?className="([^"]*)"/.exec(src.slice(mapAt, mapAt + 400));
      expect(link, `no <Link className> in the row's map in ${file}`).not.toBeNull();
      const classes = link![1];
      expect(minHeightPx(classes), `${file}: "${classes}"`).toBeGreaterThanOrEqual(24);
      // min-height only applies to a box that is not plain inline text.
      expect(classes.split(/\s+/)).toContain("inline-flex");
      expect(classes.split(/\s+/)).toContain("items-center");
    });
  }

  it("the table covers every cross-link row (a new row elsewhere must be added here)", () => {
    const rowFiles = [
      "src/app/(app)/scholarships/fully-funded/page.tsx",
      "src/app/(app)/scholarships/degree/[level]/page.tsx",
      "src/app/(app)/scholarships/[id]/page.tsx",
      "src/app/(app)/jobs/remote/page.tsx",
      "src/app/(app)/jobs/remote/[country]/page.tsx",
      "src/app/(app)/jobs/in/[city]/page.tsx",
      "src/app/(app)/jobs/[id]/page.tsx",
    ];
    expect(PAGES.map((p) => p.file).sort()).toEqual([...rowFiles].sort());
  });
});
