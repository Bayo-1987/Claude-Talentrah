/**
 * PR-E2b: the aggregator's ingest upserts external rows on dedup_fingerprint. An upsert updates only the columns it lists, so as long as the row it builds never lists apply_email, an address
 * already stored (by the sheet import, PR-E3) is never overwritten or cleared by a later fetch. Pinned as source: the ingest file must not name the column.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("src/lib/jobs/ingest.ts", () => {
  const src = readFileSync(path.join(process.cwd(), "src/lib/jobs/ingest.ts"), "utf8");
  it("does not name apply_email, so its upsert can never touch a stored address", () => {
    expect(src).not.toMatch(/apply_email|applyEmail/);
  });
  it("upserts on dedup_fingerprint (the shape this guarantee depends on)", () => {
    expect(src).toContain('onConflict: "dedup_fingerprint"');
  });
});
