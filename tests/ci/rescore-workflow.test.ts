/**
 * How the rescore is triggered in production (S3-63 3b): a manual workflow_dispatch workflow that calls the route with the repo secret the ingest
 * workflow ALREADY uses (CRON_SECRET), so no new secret exists. It is manual-only (never on a schedule or a push), waits longer than the route's
 * maxDuration, never retries, queues instead of overlapping, never echoes the secret or traces the shell, and its log (public) carries counts only.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const file = ".github/workflows/rescore-stale-match-scores.yml";
const workflow = readFileSync(file, "utf8");
const code = workflow
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("#"))
  .join("\n");
const route = readFileSync("src/app/api/admin/rescore-stale-match-scores/route.ts", "utf8");
const maxDuration = Number(route.match(/^export const maxDuration = (\d+);/m)?.[1]);

describe("rescore-stale-match-scores workflow", () => {
  it("is manual only: workflow_dispatch, no schedule, no push or pull_request trigger", () => {
    expect(code).toMatch(/workflow_dispatch:/);
    expect(code).not.toMatch(/^\s*schedule:/m);
    expect(code).not.toMatch(/^\s*(push|pull_request|pull_request_target|workflow_run):/m);
  });

  it("defaults to a DRY RUN: a dry_run input that is true unless someone chooses otherwise", () => {
    expect(code).toMatch(/dry_run:/);
    expect(code).toMatch(/dry_run:[\s\S]*?default:\s*true/);
  });

  it("a write run needs a second typed input, confirm_write, with NO default that would satisfy it", () => {
    expect(code).toMatch(/confirm_write:/);
    expect(code).not.toMatch(/confirm_write:[\s\S]*?default:\s*["']?write/);
    expect(code).toMatch(/CONFIRM_WRITE:\s*\$\{\{\s*inputs\.confirm_write\s*\}\}/);
  });

  it("uses the existing CRON_SECRET (no new secret) via the Authorization header, and the route accepts exactly that", () => {
    expect([...code.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1])).toEqual(["CRON_SECRET"]);
    expect(code).toMatch(/Authorization: Bearer \$CRON_SECRET/);
    expect(route).toMatch(/requireCronSecret/);
  });

  it("waits above maxDuration, never retries, queues without cancelling, and has a job timeout above its calls", () => {
    const curlMax = Number(code.match(/--max-time (\d+)/)?.[1]);
    expect(curlMax).toBeGreaterThanOrEqual(maxDuration + 15);
    expect(code).not.toMatch(/--retry/);
    expect(code).toMatch(/cancel-in-progress:\s*false/);
    expect(Number(code.match(/timeout-minutes:\s*(\d+)/)?.[1])).toBeGreaterThan(5);
  });

  it("asks for no token permissions at all (it uses no GITHUB_TOKEN)", () => {
    expect(code).toMatch(/^permissions:\s*\{\}\s*$/m);
  });

  it("never echoes the secret or traces the shell, and prints only the route's counts (ids stripped as a second line of defence)", () => {
    expect(code).not.toMatch(/set -x/);
    expect(code).not.toMatch(/echo[^\n]*CRON_SECRET/);
    expect(code).toMatch(/jq/);
    expect(code).toMatch(/<id>/);
  });

  it("a write run loops with the cursor until complete is true, with a ceiling on the number of calls", () => {
    expect(code).toMatch(/nextCursor/);
    expect(code).toMatch(/complete/);
    expect(code).toMatch(/for .* in \$\(seq 1 \d+\)/);
  });
});
