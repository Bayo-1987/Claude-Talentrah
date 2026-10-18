/**
 * The data export code can only touch the `data-exports` bucket. No database needed.
 *
 *  1. Every `storage.from(...)` call in the data export code (src/lib/data-export, the sweep route, the download route, the admin start route) passes the constant DATA_EXPORT_BUCKET: never a string
 *     literal, never another constant. A failure names the file and the line.
 *  2. DATA_EXPORT_BUCKET is pinned to the literal "data-exports" (the bucket 0263 creates, private, with no storage policies).
 *  3. The scanner is shown flagging a literal bucket (`job-banners`) and another constant BEFORE it is used on the real files.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_EXPORT_BUCKET } from "@/lib/data-export/constants";

const ROOT = join(__dirname, "../..");
const SCOPE = ["src/lib/data-export", "src/app/api/admin/sweep-data-exports", "src/app/data-export", "src/app/admin/data-export"];

const walk = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

/** Source with block and line comments removed, newlines kept so line numbers stay true. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

export interface Finding {
  file: string;
  line: number;
  argument: string;
}

/** Every `storage.from(<argument>)` call whose argument is not exactly DATA_EXPORT_BUCKET. */
export function badBucketCalls(file: string, source: string): Finding[] {
  const code = stripComments(source);
  const found: Finding[] = [];
  for (const m of code.matchAll(/storage\s*\.\s*from\s*\(([^)]*)\)/g)) {
    const argument = m[1].trim();
    if (argument !== "DATA_EXPORT_BUCKET") found.push({ file, line: code.slice(0, m.index).split("\n").length, argument });
  }
  return found;
}

export function countBucketCalls(source: string): number {
  return [...stripComments(source).matchAll(/storage\s*\.\s*from\s*\(/g)].length;
}

describe("the scanner flags the bad cases (red-first, in-memory sources)", () => {
  it("reports a string literal bucket", () => {
    expect(badBucketCalls("x.ts", 'const b = service.storage.from("job-banners");')).toEqual([{ file: "x.ts", line: 1, argument: '"job-banners"' }]);
  });

  it("reports another constant", () => {
    expect(badBucketCalls("x.ts", "const b = service.storage.from(SOME_OTHER_BUCKET);")).toEqual([{ file: "x.ts", line: 1, argument: "SOME_OTHER_BUCKET" }]);
  });

  it("reports both in one file, with their line numbers, and also a call split across lines and a template literal", () => {
    const src = ['service.storage.from("job-banners");', "", "service.storage", "  .from(SOME_OTHER_BUCKET);", "service.storage.from(`job-${x}`);"].join("\n");
    expect(badBucketCalls("y.ts", src).map((f) => [f.line, f.argument])).toEqual([
      [1, '"job-banners"'],
      [3, "SOME_OTHER_BUCKET"],
      [5, "`job-${x}`"],
    ]);
  });

  it("accepts the constant, and ignores a mention in a comment", () => {
    expect(badBucketCalls("z.ts", "service.storage.from(DATA_EXPORT_BUCKET).remove([p]);\n// storage.from('job-banners')\n/* storage.from(OTHER) */")).toEqual([]);
  });
});

describe("the data export code only touches the data-exports bucket", () => {
  const files = SCOPE.flatMap(walk).filter((f) => /\.(ts|tsx)$/.test(f));

  it("scans a real set of files and finds the real storage calls (the check is not empty)", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
    const calls = files.reduce((n, f) => n + countBucketCalls(readFileSync(join(ROOT, f), "utf8")), 0);
    expect(calls).toBeGreaterThanOrEqual(4);
  });

  it("every storage.from( call passes DATA_EXPORT_BUCKET", () => {
    const bad = files.flatMap((f) => badBucketCalls(f, readFileSync(join(ROOT, f), "utf8")));
    expect(bad.map((b) => `${b.file}:${b.line} storage.from(${b.argument})`)).toEqual([]);
  });

  it("DATA_EXPORT_BUCKET is the literal \"data-exports\", pinned in constants.ts", () => {
    expect(DATA_EXPORT_BUCKET).toBe("data-exports");
    expect(readFileSync(join(ROOT, "src/lib/data-export/constants.ts"), "utf8")).toMatch(/export const DATA_EXPORT_BUCKET = "data-exports";/);
  });
});
