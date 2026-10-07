/**
 * The required CI jobs have time limits. A hung step (on 7 Oct a shard sat 23 minutes in `npx playwright install` and starved a required check for a
 * whole PR) would otherwise hold a job until GitHub's six-hour default. The limits sit well above the measured times so a slow run is not killed:
 * unit 7.5-8.6 min against 25, a shard 9.8-12.2 min (setup included) against 30, the browser install about 22 s against 8 minutes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = { name?: string; "timeout-minutes"?: number };
type Job = { name?: string; "timeout-minutes"?: number; steps?: Step[] };
const jobs = (parse(readFileSync(".github/workflows/ci.yml", "utf8")) as { jobs: Record<string, Job> }).jobs;

describe("ci.yml time limits", () => {
  it("the unit job (Typecheck, lint, unit tests) has a job limit of 25 minutes", () => {
    expect(jobs.checks.name).toBe("Typecheck, lint, unit tests");
    expect(jobs.checks["timeout-minutes"]).toBe(25);
  });

  it("each e2e shard job has a job limit of 30 minutes", () => {
    expect(jobs["e2e-shard"]["timeout-minutes"]).toBe(30);
  });

  it("the Playwright browser install step has a step limit of 8 minutes", () => {
    const install = (jobs["e2e-shard"].steps ?? []).find((s) => s.name === "Install Playwright browsers");
    expect(install, "the install step must keep its name or this guard cannot find it").toBeDefined();
    expect(install?.["timeout-minutes"]).toBe(8);
  });

  it("the limits are above the measured times with room (a limit at or below them would kill a normal run)", () => {
    expect(jobs.checks["timeout-minutes"]!).toBeGreaterThan(8.6 * 2);
    expect(jobs["e2e-shard"]["timeout-minutes"]!).toBeGreaterThan(12.2 * 2);
  });
});
