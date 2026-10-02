/**
 * S12 (e) — every place that records a POSTING's seniority uses `inferJobSeniority` (unknown when the title is silent), and
 * nothing outside the matcher's resume path calls the defaulting `inferSeniority`.
 *
 * Source-level on purpose, like tests/jobs/supersession-read-paths.test.ts: it needs no database, and a new adapter that
 * reaches for the old function would put the "everything is mid" bug straight back with every other test still green.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ALLOWED_DEFAULTING_CALLERS = new Set([
  "src/lib/jobs/extract-jd.ts", // defines it
  "src/lib/matching/score.ts", // the candidate's own latest title: unchanged by design
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("posting seniority is inferred without a default", () => {
  const root = process.cwd();
  const sources = walk(join(root, "src")).map((f) => ({
    file: relative(root, f),
    // comments removed: a header that names the old function must not trip the scan
    text: readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{}(),])\/\/.*$/gm, "$1"),
  }));

  it("only the matcher's resume path calls inferSeniority", () => {
    const callers = sources.filter((s) => /\binferSeniority\b/.test(s.text)).map((s) => s.file);
    expect(callers.filter((f) => !ALLOWED_DEFAULTING_CALLERS.has(f))).toEqual([]);
  });

  it.each([
    "src/lib/jobs/sources/greenhouse.ts",
    "src/lib/jobs/sources/lever.ts",
    "src/lib/jobs/sources/workable.ts",
    "src/lib/jobs/sources/schema-org.ts",
    "src/lib/employer/draft-job-action.ts",
    "src/lib/employer/job-import/extract.ts",
  ])("%s uses inferJobSeniority", (file) => {
    expect(sources.find((s) => s.file === file)!.text).toMatch(/\binferJobSeniority\b/);
  });
});
