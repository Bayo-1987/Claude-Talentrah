/**
 * T-A7: the generation route (the admin start handler) and the sweep route each export `maxDuration = 300` as a LITERAL (Next reads it statically), the way the ingest route does
 * (tests/matching/post-ingest-refresh-limits.test.ts pins that one), and docs/admin-data-export.md records why and what happens when the limit is hit.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROUTES = ["src/app/admin/data-export/route.ts", "src/app/api/admin/sweep-data-exports/route.ts", "src/app/data-export/[id]/route.ts"];
const doc = readFileSync("docs/admin-data-export.md", "utf8");

describe("maxDuration", () => {
  it.each(ROUTES)("%s exports the literal `export const maxDuration = 300;`", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toMatch(/^export const maxDuration = 300;$/m);
  });

  it("the ingest route's literal is the same number (the repo pins 300)", () => {
    expect(readFileSync("src/app/api/admin/ingest-jobs/route.ts", "utf8")).toMatch(/^export const maxDuration = 300;$/m);
  });

  it("the doc records why 300, that generation aborts on a table it cannot read, and what happens at the limit", () => {
    expect(doc).toMatch(/maxDuration/);
    expect(doc).toMatch(/300/);
    expect(doc).toMatch(/Hobby maximum/);
    expect(doc).toMatch(/aborts on a table it cannot read/);
    expect(doc).toMatch(/the attempt becomes\s+`failed`/);
    expect(doc).toMatch(/a new export can start at once/);
  });
});
