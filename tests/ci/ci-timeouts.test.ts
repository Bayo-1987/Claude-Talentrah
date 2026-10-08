/**
 * The required CI jobs have time limits. A hung step (on 7 Oct a shard sat 23 minutes in `npx playwright install` and starved a required check for a
 * whole PR) would otherwise hold a job until GitHub's six-hour default. The limits sit well above the measured times so a slow run is not killed:
 * unit 7.5-8.6 min against 25, a shard 9.8-12.2 min (setup included) against 30, the browser install about 22 s against 18 minutes (it can be slow on a bad mirror day, see the install step).
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

  it("the Playwright browser install step has a step limit of 18 minutes", () => {
    const install = (jobs["e2e-shard"].steps ?? []).find((s) => s.name === "Install Playwright browsers");
    expect(install, "the install step must keep its name or this guard cannot find it").toBeDefined();
    expect(install?.["timeout-minutes"]).toBe(18);
  });

  it("the install step's worst case plus a normal shard's other steps (about 9 min) stays under the shard job limit", () => {
    const installWorst = 3 * 300 + 2 * 20 + 15;
    expect(installWorst / 60 + 9).toBeLessThan(jobs["e2e-shard"]["timeout-minutes"]!);
    expect(installWorst).toBeLessThan(jobs["e2e-shard"].steps!.find((st) => st.name === "Install Playwright browsers")!["timeout-minutes"]! * 60);
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
  function run(scenario: ("ok" | "fail")[], extraEnv: Record<string, string> = {}) {
    dir = mkdtempSync(path.join(tmpdir(), "pwinstall-"));
    const bin = (name: string, body: string) => {
      writeFileSync(path.join(dir, name), `#!/bin/bash\n${body}\n`);
      chmodSync(path.join(dir, name), 0o755);
    };
    writeFileSync(path.join(dir, "scenario"), scenario.join("\n") + "\n");
    writeFileSync(path.join(dir, "calls"), "");
    bin("npx", `echo "npx" >> "${dir}/events"; echo "$*" >> "${dir}/calls"; n=$(wc -l < "${dir}/calls" | tr -d ' '); r=$(sed -n "$\{n\}p" "${dir}/scenario"); [ "$r" = "ok" ]`);
    bin("timeout", `echo "$1" >> "${dir}/timeouts"; shift; exec "$@"`);
    bin("sleep", `echo "$1" >> "${dir}/sleeps"; echo "sleep $1" >> "${dir}/events"`);
    // The cleanup runs apt tools through sudo; the fakes record what was asked and never touch the machine.
    bin("sudo", `exec "$@"`);
    bin("pkill", `echo "pkill $*" >> "${dir}/events"; [ "\${PKILL_FOUND:-1}" = "1" ]`);
    // pgrep says "a process is still there" for the first APT_BUSY calls, then "none" (or always, if APT_BUSY is large).
    bin("pgrep", `echo "pgrep $*" >> "${dir}/events"; c=$(grep -c '^pgrep' "${dir}/events"); [ "$c" -le "\${APT_BUSY:-0}" ]`);
    const res = spawnSync("bash", ["-e", "-c", install().run!], { env: { ...process.env, ...extraEnv, PATH: `${dir}:${process.env.PATH}` }, encoding: "utf8", timeout: 20_000 });
    const read = (f: string) => {
      try {
        return readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean);
      } catch {
        return [];
      }
    };
    return { status: res.status, out: res.stdout + res.stderr, calls: read("calls"), timeouts: read("timeouts"), sleeps: read("sleeps").map(Number), events: read("events") };
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

  it("every attempt is cut off by `timeout 300` (a slow mirror makes progress across attempts: 8 Oct, #844), and three attempts plus the sleeps stay under the step's own limit", () => {
    const r = run(["fail", "fail", "ok"]);
    expect(r.timeouts).toEqual(["300", "300", "300"]);
    const worst = 3 * 300 + 5 + 10;
    expect(worst).toBeLessThan(install()["timeout-minutes"]! * 60);
  });

  /**
   * 8 Oct, #831: attempt 1 stalled in `apt-get update`; `timeout` killed `npx` but not the apt-get that Playwright had started as root, so that child kept
   * the apt lock and attempts 2 and 3 died in about 10 s each on "Could not get lock /var/lib/apt/lists/lock. It is held by process ...". A retry that
   * does not first clear the surviving apt child cannot recover from a stalled apt.
   */
  it("after a failed attempt it stops any leftover apt-get and dpkg BEFORE the next attempt, and not after a success", () => {
    const r = run(["fail", "ok"]);
    expect(r.status).toBe(0);
    const firstNpx = r.events.indexOf("npx");
    const secondNpx = r.events.indexOf("npx", firstNpx + 1);
    const between = r.events.slice(firstNpx + 1, secondNpx);
    expect(between).toContain("pkill -x apt-get");
    expect(between).toContain("pkill -x dpkg");
    const ok = run(["ok"]);
    expect(ok.events.filter((e) => e.startsWith("pkill"))).toEqual([]);
  });

  it("a cleanup that finds nothing to stop (pkill exits 1) does not fail the step (the job runs under bash -e)", () => {
    const r = run(["fail", "ok"], { PKILL_FOUND: "0" });
    expect(r.status).toBe(0);
    expect(r.calls).toHaveLength(2);
  });

  it("it waits until no apt-get or dpkg process is left before the next attempt, and does not use -9 when they went away", () => {
    const r = run(["fail", "ok"], { APT_BUSY: "2" });
    expect(r.status).toBe(0);
    const firstNpx = r.events.indexOf("npx");
    const secondNpx = r.events.indexOf("npx", firstNpx + 1);
    const between = r.events.slice(firstNpx + 1, secondNpx);
    const pgreps = between.filter((e) => e.startsWith("pgrep"));
    expect(pgreps).toContain("pgrep -x apt-get");
    expect(pgreps).toContain("pgrep -x dpkg");
    // two busy answers mean two waits of 2 s before the lock is free; the 5 s backoff comes after them
    expect(between.filter((e) => e === "sleep 2")).toHaveLength(2);
    expect(between.lastIndexOf("sleep 5")).toBeGreaterThan(between.lastIndexOf("sleep 2"));
    expect(between.some((e) => e.startsWith("pkill -9"))).toBe(false);
  });

  it("the wait is bounded: a process that never goes away is killed with -9 once, the attempt count is unchanged and the step still ends", () => {
    const r = run(["fail", "fail", "fail"], { APT_BUSY: "100000" });
    expect(r.status).toBe(1);
    expect(r.calls).toHaveLength(3);
    expect(r.events.filter((e) => e === "pkill -9 -x apt-get")).toHaveLength(2);
    expect(r.out).toContain("failed after 3 attempts");
  });

  it("the worst case (every attempt times out, every cleanup waits its full bound) is still under the step's limit", () => {
    const r = run(["fail", "fail", "fail"], { APT_BUSY: "100000" });
    const waits = r.sleeps.reduce((a, b) => a + b, 0);
    expect(3 * 300 + waits).toBeLessThan(install()["timeout-minutes"]! * 60);
  });

  it("never deletes an apt lock file (a lock removed under a live apt corrupts the package state)", () => {
    expect(install().run).not.toMatch(/\brm\b|unlink|truncate|>\s*\/var\/lib\/(apt|dpkg)/);
  });

  it("uses no third-party retry action", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).not.toMatch(/nick-fields\/retry|retry-action|wretry|Wandalen/i);
  });
});
