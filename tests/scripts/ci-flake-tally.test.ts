/**
 * #593 — the pool-failure classifier in scripts/ci-flake-tally.py, run against failure blocks copied from real CI logs.
 *
 * The script is Python; it is exercised through its own `--classify-pool` mode (log on stdin, JSON on stdout), so this
 * test runs exactly what the tally runs. Needs `python3` on the PATH, as CI's ubuntu runner and a dev machine both have.
 *
 * Fixtures (tests/fixtures/ci-log-snippets/), each a verbatim block from the unit job's log of the run named here:
 *   pool-drained.txt                      run 36707667916 attempt 1 — test-user-pool.test.ts, "drained the entire pool (16 rows)"
 *   pool-claim-user-not-found.txt         run 36709881263 attempt 1 — course-catalog, claimFromPool → `User not found` (404)
 *   pool-claim-retryable.txt              run 36707349625 attempt 1 — course-catalog, claimFromPool → AuthRetryableFetchError
 *   pool-resumes-fkey-setup.txt           run 36760454173 attempt 1 — applicant-filters, resumes_user_id_fkey in beforeAll
 *   nonpool-refresh-job.txt               run 36704506607 attempt 1 — a refresh-job.test.ts failure (must NOT match)
 *   nearmiss-interleaving-404-message.txt run 36762714706 attempt 1 — the red-state interleaving's own assertion text,
 *                                         which quotes `404 user_not_found` but is not a claimFromPool failure (must NOT match)
 *   font-build-failure.txt                run 36720469297 attempt 1 — `Build app` failing on the next/font/google fetch (#585)
 *   nonfont-build-failure.txt             a real `Build app` failure that is not the font one (a TypeScript error in a
 *                                         throwaway probe; must NOT match the font class)
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "tests", "fixtures", "ci-log-snippets");
const fixture = (name: string) => readFileSync(join(DIR, name), "utf8");

function classify(log: string): Record<string, number> {
  const r = spawnSync("python3", [join(process.cwd(), "scripts", "ci-flake-tally.py"), "--classify-pool"], {
    input: log,
    encoding: "utf8",
  });
  expect(r.error, "python3 must be runnable").toBeUndefined();
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
}

function classifyFont(log: string): Record<string, number> {
  const r = spawnSync("python3", [join(process.cwd(), "scripts", "ci-flake-tally.py"), "--classify-font"], {
    input: log,
    encoding: "utf8",
  });
  expect(r.error, "python3 must be runnable").toBeUndefined();
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
}

describe("ci-flake-tally.py --classify-font, on logs from real runs (#585)", () => {
  it("finds the next/font/google build failure", () => {
    expect(classifyFont(fixture("font-build-failure.txt"))).toEqual({ "font-build": 1 });
  });

  it("a Build app failure that is not the font fetch is not counted", () => {
    expect(classifyFont(fixture("nonfont-build-failure.txt"))).toEqual({});
  });

  it("a different Turbopack 'Can't resolve' (synthetic: not from a real run) is not the font failure", () => {
    expect(classifyFont("Error: Module not found: Can't resolve '@/lib/does-not-exist'\n")).toEqual({});
    expect(classifyFont("Error: Module not found: Can't resolve '@vercel/turbopack-next/internal/something-else'\n")).toEqual({});
  });

  it("none of the pool or refresh-job failures is a font failure, and the font failure is not a pool failure", () => {
    for (const f of ["pool-drained.txt", "pool-claim-user-not-found.txt", "pool-claim-retryable.txt", "pool-resumes-fkey-setup.txt", "nonpool-refresh-job.txt", "nearmiss-interleaving-404-message.txt"]) {
      expect(classifyFont(fixture(f)), f).toEqual({});
    }
    expect(classify(fixture("font-build-failure.txt"))).toEqual({});
  });

  it("an empty log has no failures", () => {
    expect(classifyFont("")).toEqual({});
  });
});

describe("ci-flake-tally.py --classify-pool, on blocks from real runs", () => {
  it.each([
    ["pool-drained.txt", "drained"],
    ["pool-claim-user-not-found.txt", "claim-user-not-found"],
    ["pool-claim-retryable.txt", "claim-retryable"],
    ["pool-resumes-fkey-setup.txt", "resumes-fkey"],
  ])("%s is exactly one %s failure", (file, cls) => {
    expect(classify(fixture(file))).toEqual({ [cls]: 1 });
  });

  it("a refresh-job failure is not a pool failure", () => {
    expect(classify(fixture("nonpool-refresh-job.txt"))).toEqual({});
  });

  it("an assertion message that merely quotes user_not_found, with no claimFromPool frame, is not a claim failure", () => {
    const block = fixture("nearmiss-interleaving-404-message.txt");
    expect(block).toContain("user_not_found");
    expect(classify(block)).toEqual({});
  });

  it("a whole log counts each class once per block, not once per mention, and ignores the ##[error] repeats", () => {
    const blocks = ["pool-drained.txt", "pool-claim-user-not-found.txt", "pool-claim-retryable.txt", "pool-resumes-fkey-setup.txt", "nonpool-refresh-job.txt", "nearmiss-interleaving-404-message.txt"]
      .map(fixture)
      .join("⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n");
    const repeats = blocks
      .split("\n")
      .filter((l) => /drained the entire pool|User not found|AuthRetryableFetchError|resumes_user_id_fkey/.test(l))
      .map((l) => `##[error]${l.replace(/^\S+Z /, "")}`)
      .join("\n");
    expect(classify(`${blocks}\n${repeats}\n`)).toEqual({
      drained: 1,
      "claim-user-not-found": 1,
      "claim-retryable": 1,
      "resumes-fkey": 1,
    });
  });

  it("an empty log has no failures", () => {
    expect(classify("")).toEqual({});
  });
});
