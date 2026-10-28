/**
 * Pinch-zoom must stay possible (accessibility). The fix for the iPhone focus-zoom is a 16px minimum on the composer, NOT a viewport that forbids zooming. So no file under src or public may carry
 * `maximum-scale`, `user-scalable`, `maximumScale` or `userScalable`, and the root layout's `viewport` export sets nothing but what it sets today.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|html|json|webmanifest|css|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

describe("the viewport never forbids zooming", () => {
  const FILES = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "public"))];

  it("scans real files (not vacuous)", () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.some((f) => f.endsWith(path.join("src", "app", "layout.tsx")))).toBe(true);
  });

  it("no source or public file says maximum-scale, user-scalable, maximumScale or userScalable", () => {
    const hits = FILES.filter((f) => /maximum-scale|user-scalable|maximumScale|userScalable/i.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it("the root layout's viewport export holds only the theme colour", () => {
    const layout = readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");
    const block = /export const viewport: Viewport = \{([\s\S]*?)\n\};/.exec(layout);
    expect(block, "the viewport export moved or changed shape").not.toBeNull();
    const keys = [...block![1].matchAll(/^\s*([A-Za-z]+)\s*:/gm)].map((m) => m[1]);
    expect(keys).toEqual(["themeColor"]);
  });
});
