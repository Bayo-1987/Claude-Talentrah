/**
 * The GitHub Actions caller of the ingest route (about every 3 hours) must not give up before the route finishes, and must not start a second ingest
 * by retrying. The route now also runs the match-score refresh inside the same request, so it can take up to its maxDuration (300 s, the Hobby ceiling).
 * Found: the workflow had `curl --max-time 60`, which a longer ingest would trip (curl aborts, the run goes red, the route keeps running).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ingest-jobs-3hourly.yml", "utf8");
/** The workflow without its comment lines (the header comments talk about the secret and about retries). */
const code = workflow
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("#"))
  .join("\n");
const route = readFileSync("src/app/api/admin/ingest-jobs/route.ts", "utf8");
const maxDuration = Number(route.match(/^export const maxDuration = (\d+);/m)?.[1]);
const curlMax = Number(code.match(/--max-time (\d+)/)?.[1]);
const stepTimeoutMinutes = Number(workflow.match(/timeout-minutes: (\d+)/)?.[1]);

describe("the ingest-jobs-3hourly workflow", () => {
  it("waits longer than the route can run: curl --max-time is above maxDuration with margin", () => {
    expect(Number.isInteger(maxDuration)).toBe(true);
    expect(curlMax, "curl --max-time must be set").toBeGreaterThan(0);
    expect(curlMax).toBeGreaterThanOrEqual(maxDuration + 15);
  });

  it("the job's own timeout is above the curl timeout", () => {
    expect(stepTimeoutMinutes * 60).toBeGreaterThan(curlMax);
  });

  it("never retries: no curl --retry, no retry action, so a slow run cannot start a second ingest", () => {
    expect(code).not.toMatch(/--retry/);
    expect(code).not.toMatch(/nick-fields\/retry|retry-action|wretry/i);
  });

  it("still queues rather than overlaps or cancels: its own concurrency group, cancel-in-progress false", () => {
    expect(workflow).toMatch(/group:\s*ingest-jobs-3hourly/);
    expect(workflow).toMatch(/cancel-in-progress:\s*false/);
  });

  it("a non-2xx answer or a curl failure (timeout) fails the run, with an error line saying so", () => {
    expect(code).toMatch(/::error::ingest-jobs request failed/);
    expect(code).toMatch(/::error::ingest-jobs answered HTTP/);
    expect(workflow).toMatch(/exit 1/);
  });

  it("prints the post-ingest refresh summary as one line, so the Actions log keeps the history Vercel's one-hour logs cannot", () => {
    expect(code).toMatch(/postIngestRefresh/);
  });

  it("does not echo the secret or trace the command", () => {
    expect(code).not.toMatch(/set -x/);
    expect(code).not.toMatch(/echo[^\n]*CRON_SECRET/);
  });
});
