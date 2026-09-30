/**
 * #585 — the build must not reach Google for a font.
 *
 * `next/font/google` downloads the CSS and every woff2 from fonts.googleapis.com / fonts.gstatic.com while `next build`
 * runs, and Turbopack fails the whole build when a download fails ("Can't resolve
 * '@vercel/turbopack-next/internal/font/google/font'"): nine CI builds failed that way in a day, before any test ran.
 * The fonts are committed under src/fonts instead, so a build needs no network for them.
 *
 * THE RULE. After comments are removed, nothing under `src/` (`.ts`/`.tsx`/`.js`/`.mjs`/`.css`) and no `next.config.ts`
 * may contain `next/font/google` or the hosts `fonts.googleapis.com` / `fonts.gstatic.com`, except the entries in
 * ALLOWED below. A new call site, a `@import url(https://fonts.googleapis.com/…)`, or a `<link>` to either host fails by
 * default. Each allowed entry must still match something, so a stale entry fails too.
 *
 * NOT COVERED. A font host written some other way (assembled from pieces, a different CDN), and anything outside `src/`
 * and `next.config.ts`. The build-without-network run in the PR is the check that does not depend on this scan.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/** Every reference the scan accepts, by file and the exact text it accepts there, each with its reason. */
const ALLOWED: ReadonlyArray<{ file: string; text: string; why: string }> = [
  {
    file: "src/lib/seo/og-card.tsx",
    text: "fonts.googleapis.com",
    why:
      "the share-card image route fetches Newsreader and Source Sans 3 as ttf, at request time on the server, because " +
      "Satori cannot read woff2 and these routes render per crawl, not at build; on any failure it renders with next/og's " +
      "own font. A server-to-Google request that cannot fail a build.",
  },
];

const FORBIDDEN = /next\/font\/google|fonts\.googleapis\.com|fonts\.gstatic\.com/g;

/** Removes block comments everywhere and line comments that start a line or follow whitespace (not the `//` of `https://`). */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[\s;{}(),])\/\/.*$/gm, "$1");
}

export interface FontSite {
  line: number;
  text: string;
}

export function findFontSites(source: string): FontSite[] {
  const sites: FontSite[] = [];
  stripComments(source)
    .split("\n")
    .forEach((line, i) => {
      for (const m of line.matchAll(FORBIDDEN)) sites.push({ line: i + 1, text: m[0] });
    });
  return sites;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?|mjs|css)$/.test(name)) out.push(p);
  }
  return out;
}

describe("the scan itself (synthetic sources)", () => {
  it("finds an import, a stylesheet URL and a gstatic URL", () => {
    expect(findFontSites(`import { Lora } from "next/font/google";`)).toEqual([{ line: 1, text: "next/font/google" }]);
    expect(findFontSites(`@import url("https://fonts.googleapis.com/css2?family=Lora");`)).toHaveLength(1);
    expect(findFontSites(`const u = "https://fonts.gstatic.com/s/lora/x.woff2";`)).toHaveLength(1);
  });

  it("ignores the same text in comments, but not a URL string that contains //", () => {
    expect(findFontSites(`// import from "next/font/google"\n/* fonts.gstatic.com */`)).toEqual([]);
    expect(findFontSites(`/**\n * uses fonts.googleapis.com\n */\nconst a = 1;`)).toEqual([]);
    expect(findFontSites(`const U = "https://fonts.googleapis.com/css2"; // trailing`)).toHaveLength(1);
  });
});

describe("no font is fetched from Google", () => {
  const root = process.cwd();
  const files = [...walk(join(root, "src")), join(root, "next.config.ts")];
  const found = files.flatMap((f) =>
    findFontSites(readFileSync(f, "utf8")).map((s) => ({ file: relative(root, f), ...s })),
  );

  it("scans the files it is meant to scan", () => {
    expect(files.some((f) => f.endsWith("layout.tsx")), "the scan is not reading src/app/layout.tsx").toBe(true);
    expect(files.length).toBeGreaterThan(200);
  });

  it("finds no reference outside the allowlist", () => {
    const offenders = found
      .filter((s) => !ALLOWED.some((a) => a.file === s.file && a.text === s.text))
      .map((s) => `${s.file}:${s.line}: ${s.text}`);
    expect(offenders, "a build or page that asks Google for a font (#585)").toEqual([]);
  });

  it("has no stale allowlist entry", () => {
    for (const a of ALLOWED) {
      expect(found.some((s) => s.file === a.file && s.text === a.text), `${a.file} no longer contains ${a.text}: ${a.why}`).toBe(true);
    }
  });
});
