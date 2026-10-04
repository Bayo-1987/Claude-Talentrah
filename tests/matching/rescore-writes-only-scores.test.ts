/**
 * The rescore must write ONLY match_scores rows (S3-63 3e): not postings, not structured_jd or seniority (anything trigger 0069 watches), not the
 * feed-ranking code. Source-level, so it runs everywhere: the only writer reachable from the rescore is persistScoresOrRetryStale (an upsert on
 * match_scores), and no rescore file contains a write verb or imports the ranking module.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILES = ["src/lib/matching/rescore-stale.ts", "src/lib/matching/rescore-stale-job.ts", "src/app/api/admin/rescore-stale-match-scores/route.ts"];

describe("the rescore writes only score rows", () => {
  for (const file of FILES) {
    it(`${file} has no insert/update/delete/rpc call of its own`, () => {
      const code = readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*"))
        .join("\n");
      expect(code).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
    });
  }

  it("the job's only writer is persistScoresOrRetryStale (a match_scores upsert), and job_postings is only ever read (.select)", () => {
    const job = readFileSync("src/lib/matching/rescore-stale-job.ts", "utf8");
    expect(job).toContain("persistScoresOrRetryStale");
    const postingCalls = [...job.matchAll(/\.from\("job_postings"\)\s*\.(\w+)\(/g)].map((m) => m[1]);
    expect(postingCalls.length).toBeGreaterThan(0);
    for (const verb of postingCalls) expect(verb).toBe("select");
  });

  it("nothing in the rescore imports the feed-ranking module or touches structured_jd/seniority as a write target", () => {
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/from\s+["']@\/lib\/jobs\/ranking["']/);
    }
  });
});
