/**
 * "1 verified candidates" was a real shipped string: the count was interpolated into a hard-coded plural (preview.ts and the preview panel).
 * Production had exactly one listed candidate when this was written. The noun and the verb now agree with the number, everywhere the count
 * is stated, pinned over 0, 1, 2, 9, 10 and 500 (below the threshold, at it, far above it), in the helpers and in the rendered panel.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { TalentDirectoryPreviewPanel } from "@/components/employer/talent-directory-preview-panel";
import { buildingTheDirectoryMessage, isAre, verifiedCandidates } from "@/lib/talent-directory/preview";

const ROWS: Array<[number, string, "is" | "are"]> = [
  [0, "0 verified candidates", "are"],
  [1, "1 verified candidate", "is"],
  [2, "2 verified candidates", "are"],
  [9, "9 verified candidates", "are"],
  [10, "10 verified candidates", "are"],
  [500, "500 verified candidates", "are"],
];

async function noop(): Promise<void> {}
const PLANS = [{ id: "plan-1", name: "Local Sourcing — Monthly", price_ngn: 200000 }];
const render = (count: number, joined: boolean) =>
  renderToStaticMarkup(
    <TalentDirectoryPreviewPanel preview={{ count, samples: [] }} plans={PLANS} joinedWaitlist={joined} joinAction={noop} purchaseAction={noop} />,
  );
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("the helpers", () => {
  it.each(ROWS)("N = %i: verifiedCandidates and isAre", (n, phrase, verb) => {
    expect(verifiedCandidates(n)).toBe(phrase);
    expect(isAre(n)).toBe(verb);
  });
});

describe("the sentence below the threshold (not joined)", () => {
  it.each(ROWS.filter(([n]) => n < 10))("N = %i", (n, phrase) => {
    expect(buildingTheDirectoryMessage(n)).toBe(`We're building the directory: ${phrase} so far. Join the waitlist and we'll tell you when 10+ are listed.`);
    expect(text(render(n, false))).toContain(`We're building the directory: ${phrase} so far.`);
  });
});

describe("the sentence below the threshold (already on the waitlist)", () => {
  it.each(ROWS.filter(([n]) => n < 10))("N = %i", (n, phrase, verb) => {
    expect(text(render(n, true))).toContain(`${phrase} ${verb} listed so far. We'll tell you when 10+ are listed. Nothing to pay.`);
  });
});

describe("the sentence at and above the threshold", () => {
  it.each(ROWS.filter(([n]) => n >= 10))("N = %i", (n, phrase, verb) => {
    expect(text(render(n, false))).toContain(`${phrase} ${verb} listed.`);
  });
});

describe("'1 verified candidates' appears nowhere", () => {
  it("not in any rendered state at 1", () => {
    for (const joined of [false, true]) expect(text(render(1, joined))).not.toMatch(/\b1 verified candidates\b/);
    expect(buildingTheDirectoryMessage(1)).not.toMatch(/\b1 verified candidates\b/);
  });

  it("not hard-coded in source: no template puts a count in front of the plural noun except through the helper", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !p.endsWith(join("talent-directory", "preview.ts"))) {
          readFileSync(p, "utf8").split("\n").forEach((l, i) => {
            if (/\$\{[^}]+\}\s+verified candidates/.test(l) && !/^\s*(\*|\/\/)/.test(l)) hits.push(`${p}:${i + 1}`);
          });
        }
      }
    };
    walk(join(__dirname, "..", "..", "src"));
    expect(hits).toEqual([]);
  });
});
