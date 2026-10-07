/**
 * The required CI jobs have time limits. A hung step (on 7 Oct a shard sat 23 minutes in `npx playwright install` and starved a required check for a
 * whole PR) would otherwise hold a job until GitHub's six-hour default. The limits sit well above the measured times so a slow run is not killed:
 * unit 7.5-8.6 min against 25, a shard 9.8-12.2 min (setup included) against 30, the browser install about 22 s against 8 minutes.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = { name?: string; "timeout-minutes"?: number; run?: string };
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


/**
 * The browser install step retries, in plain shell, and is bounded. The download both hangs (a shard sat 23 minutes in it on 7 Oct) and is refused
 * (cdn.playwright.dev 403 on #820). The step's own script is run here against a fake `npx` (no network) with a fake `timeout` that records its limit.
 */
describe("the Playwright install step's retry", () => {
  const install = () => (jobs["e2e-shard"].steps ?? []).find((s) => s.name === "Install Playwright browsers")!;
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  /** Runs the step's script. `scenario` is one entry per npx call: "ok" succeeds, "fail" exits 1. */
  function run(scenario: ("ok" | "fail")[]) {
    dir = mkdtempSync(path.join(tmpdir(), "pwinstall-"));
    const bin = (name: string, body: string) => {
      writeFileSync(path.join(dir, name), `#!/bin/bash\n${body}\n`);
      chmodSync(path.join(dir, name), 0o755);
    };
    writeFileSync(path.join(dir, "scenario"), scenario.join("\n") + "\n");
    writeFileSync(path.join(dir, "calls"), "");
    bin("npx", `echo "$*" >> "${dir}/calls"; n=$(wc -l < "${dir}/calls" | tr -d ' '); r=$(sed -n "$\{n\}p" "${dir}/scenario"); [ "$r" = "ok" ]`);
    bin("timeout", `echo "$1" >> "${dir}/timeouts"; shift; exec "$@"`);
    bin("sleep", `echo "$1" >> "${dir}/sleeps"`);
    const res = spawnSync("bash", ["-e", "-c", install().run!], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: "utf8" });
    const read = (f: string) => {
      try {
        return readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean);
      } catch {
        return [];
      }
    };
    return { status: res.status, out: res.stdout + res.stderr, calls: read("calls"), timeouts: read("timeouts"), sleeps: read("sleeps").map(Number) };
  }

  it("a first-try success installs once, with no sleep", () => {
    const r = run(["ok"]);
    expect(r.status).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toBe("playwright install --with-deps chromium");
    expect(r.sleeps).toEqual([]);
  });

  it("a refused download (two failures then success) is retried and the step passes on the third attempt, sleeping 5 s then 10 s", () => {
    const r = run(["fail", "fail", "ok"]);
    expect(r.status).toBe(0);
    expect(r.calls).toHaveLength(3);
    expect(r.sleeps).toEqual([5, 10]);
    expect(r.out).toContain("installed on attempt 3");
  });

  it("three failures in a row fail the step (a persistent refusal must not turn into a false pass or a loop), after exactly three attempts", () => {
    const r = run(["fail", "fail", "fail", "ok"]);
    expect(r.status).toBe(1);
    expect(r.calls).toHaveLength(3);
    expect(r.out).toContain("failed after 3 attempts");
  });

  it("every attempt is cut off by `timeout 120`, and three attempts plus the sleeps stay under the step's own limit", () => {
    const r = run(["fail", "fail", "ok"]);
    expect(r.timeouts).toEqual(["120", "120", "120"]);
    const worst = 3 * 120 + 5 + 10;
    expect(worst).toBeLessThan(install()["timeout-minutes"]! * 60);
  });

  it("uses no third-party retry action", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).not.toMatch(/nick-fields\/retry|retry-action|wretry|Wandalen/i);
  });
});
