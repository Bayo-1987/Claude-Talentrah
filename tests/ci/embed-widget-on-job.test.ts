/**
 * EMBED-WIDGET-ON (backlog D9). The embed widget ships switched OFF (EMBED_WIDGET_ENABLED unset), so the three CI shards only ever run the OFF flow; the specs for the switched-ON flow skip themselves
 * there. This pins the NEW job that runs exactly those specs against an app started WITH the switch on, and the check that makes a skip red instead of green.
 *
 * It does NOT run on every PR and push: it runs on pushes to main, workflow_dispatch, and pull requests that touch the embed files (a small filter job decides, from the diff). 
 * What it pins: the job is new and NOT one of the required checks; the four required checks and the shard/aggregator wiring are untouched; only the two specs run; the flag is set on BOTH the app under
 * test and the Playwright process (the specs read their own copy to decide whether to skip); the job's artifacts cannot be picked up by the aggregator; and a skipped switched-ON test fails the job.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { checkEmbedOnReport, type PlaywrightJsonReport } from "../../scripts/ci/assert-embed-on-ran";

type Step = { id?: string; name?: string; run?: string; uses?: string; env?: Record<string, string>; with?: { name?: string; path?: string }; if?: string };
type Job = { name?: string; needs?: string | string[]; if?: string; "timeout-minutes"?: number; "runs-on"?: string; strategy?: unknown; steps?: Step[] };
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const jobs = (parse(workflow) as { jobs: Record<string, Job> }).jobs;
const job = jobs["e2e-embed-widget-on"];
const steps = job?.steps ?? [];
const allRun = steps.map((s) => s.run ?? "").join("\n");

describe("the new job exists and is not a required check", () => {
  it("is its own job with a name that is none of the four required checks", () => {
    expect(job, "no job e2e-embed-widget-on").toBeDefined();
    const required = ["Migration numbering", "Secret scan", "Typecheck, lint, unit tests", "Playwright e2e"];
    expect(required).not.toContain(job.name);
    expect(job.name).toMatch(/embed/i);
  });
  it("the four required checks are still there, once each, under their exact names", () => {
    const names = Object.values(jobs).map((j) => j.name);
    for (const required of ["Migration numbering", "Secret scan", "Typecheck, lint, unit tests", "Playwright e2e"]) {
      expect(names.filter((n) => n === required), required).toHaveLength(1);
    }
  });
  it("the aggregator still needs only the shards (the new job cannot hold the required 'Playwright e2e' check)", () => {
    expect(jobs["e2e"].needs).toBe("e2e-shard");
  });
  it("it has a 20 minute limit, and runs on its own runner with its own database", () => {
    expect(job["timeout-minutes"]).toBe(20);
    expect(steps.some((s) => s.uses === "./.github/actions/local-supabase")).toBe(true);
  });
});

describe("it runs only the two widget specs, with the switch on", () => {
  it("runs exactly e2e/employer-job-widget.spec.ts and e2e/qa-embed-long-token.spec.ts, not the suite", () => {
    const run = steps.find((s) => /playwright test|test:e2e/.test(s.run ?? ""));
    expect(run, "no step runs Playwright").toBeDefined();
    expect(run!.run).toContain("e2e/employer-job-widget.spec.ts");
    expect(run!.run).toContain("e2e/qa-embed-long-token.spec.ts");
    expect(run!.run).not.toMatch(/--shard/);
  });
  it("EMBED_WIDGET_ENABLED=1 is set on the app under test AND on the Playwright process", () => {
    const start = steps.find((s) => /npm run start/.test(s.run ?? ""));
    expect(start?.env?.EMBED_WIDGET_ENABLED).toBe("1");
    const run = steps.find((s) => /playwright test|test:e2e/.test(s.run ?? ""));
    expect(run?.env?.EMBED_WIDGET_ENABLED).toBe("1");
  });
  it("the flag is not set at workflow level or on any other job (the production default and the three shards stay OFF)", () => {
    expect(workflow.match(/EMBED_WIDGET_ENABLED/g)?.length ?? 0).toBeGreaterThan(0);
    for (const [key, j] of Object.entries(jobs)) {
      if (key === "e2e-embed-widget-on") continue;
      expect(JSON.stringify(j), key).not.toContain("EMBED_WIDGET_ENABLED");
    }
    const top = (parse(workflow) as { env?: Record<string, string> }).env ?? {};
    expect(top.EMBED_WIDGET_ENABLED).toBeUndefined();
  });
  it("uses the stub model like the shards, and seeds the same way", () => {
    expect(steps.find((s) => /npm run start/.test(s.run ?? ""))?.env?.LLM_PROVIDER).toBe("stub");
    expect(allRun).toContain("npm run seed:catalog");
    expect(allRun).toContain("npm run seed");
  });
});

describe("its artifacts cannot be mistaken for a shard's", () => {
  it("no upload uses a name the aggregator downloads (blob-report-shard-*), and it writes no blob report", () => {
    for (const s of steps.filter((x) => x.uses?.startsWith("actions/upload-artifact"))) {
      expect(s.with?.name).not.toMatch(/^blob-report-shard/);
      expect(s.with?.name).toMatch(/embed/i);
    }
    expect(allRun).not.toContain("blob");
  });
});

describe("a skipped switched-ON test is red, not green", () => {
  it("the job runs the report check after Playwright, and it runs even when Playwright failed", () => {
    const check = steps.find((s) => /assert-embed-on-ran/.test(s.run ?? ""));
    expect(check, "no step runs the report check").toBeDefined();
    expect(steps.indexOf(check!)).toBeGreaterThan(steps.findIndex((s) => /playwright test|test:e2e/.test(s.run ?? "")));
  });

  const spec = (file: string, title: string, status: "expected" | "skipped" | "unexpected" | "flaky") => ({
    file,
    title,
    tests: [{ status, results: [{ status: status === "expected" ? "passed" : status === "skipped" ? "skipped" : "failed" }] }],
  });
  const report = (specs: ReturnType<typeof spec>[]): PlaywrightJsonReport => ({ suites: [{ title: "x", specs }] });
  const WIDGET = "employer-job-widget.spec.ts";
  const LONG = "qa-embed-long-token.spec.ts";
  const OFF = "with the server-side switch OFF: the card says not available yet";
  const ON = "switch on, list the open job, frame it from another origin";
  const LONGT = "the framed widget has no horizontal overflow at 320px";

  it("passes when the switched-ON test and the long-token test passed and the OFF test skipped itself", () => {
    expect(checkEmbedOnReport(report([spec(WIDGET, OFF, "skipped"), spec(WIDGET, ON, "expected"), spec(LONG, LONGT, "expected")]))).toEqual({ ok: true, problems: [] });
  });
  it("FAILS when the flag was off in the run: both switched-ON tests skipped", () => {
    const r = checkEmbedOnReport(report([spec(WIDGET, OFF, "expected"), spec(WIDGET, ON, "skipped"), spec(LONG, LONGT, "skipped")]));
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(/skipped/);
    expect(r.problems.join("\n")).toContain(ON);
    expect(r.problems.join("\n")).toContain(LONGT);
  });
  it("FAILS when a spec file did not run at all", () => {
    const r = checkEmbedOnReport(report([spec(WIDGET, OFF, "skipped"), spec(WIDGET, ON, "expected")]));
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toContain(LONG);
  });
  it("FAILS when a test failed or was flaky (a retry that rescued it is not a pass for a gate that exists to be trusted)", () => {
    expect(checkEmbedOnReport(report([spec(WIDGET, ON, "unexpected"), spec(LONG, LONGT, "expected")])).ok).toBe(false);
    expect(checkEmbedOnReport(report([spec(WIDGET, ON, "flaky"), spec(LONG, LONGT, "expected")])).ok).toBe(false);
  });
  it("FAILS on an empty report", () => {
    expect(checkEmbedOnReport({ suites: [] }).ok).toBe(false);
  });
});

describe("when it runs: not on every PR and push", () => {
  const filter = jobs["embed-widget-changes"];
  const filterRun = (filter?.steps ?? []).map((st) => st.run ?? "").join("\n");
  const pattern = /grep -Eq '([^']+)'/.exec(filterRun)?.[1] ?? "";

  it("the job has an `if` that names pushes, workflow_dispatch and pull requests, and the pull-request branch needs the filter to say the embed files changed", () => {
    expect(job.if, "no `if` on the embed job").toBeDefined();
    expect(job.if).toContain("github.event_name == 'push'");
    expect(job.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(job.if).toContain("github.event_name == 'pull_request'");
    expect(job.if).toContain("needs.embed-widget-changes.outputs.changed == 'true'");
  });
  it("it needs only the filter job, and the aggregator and the required checks do not depend on either", () => {
    expect(job.needs).toBe("embed-widget-changes");
    expect(jobs["e2e"].needs).toBe("e2e-shard");
    for (const [key, j] of Object.entries(jobs)) {
      if (key === "e2e-embed-widget-on" || key === "embed-widget-changes") continue;
      const needs = ([] as string[]).concat(j.needs ?? []);
      expect(needs, key).not.toContain("e2e-embed-widget-on");
      expect(needs, key).not.toContain("embed-widget-changes");
    }
  });
  it("the filter job is also not a required check, is quick, and looks at the diff of a pull request against its base", () => {
    expect(filter).toBeDefined();
    expect(["Migration numbering", "Secret scan", "Typecheck, lint, unit tests", "Playwright e2e"]).not.toContain(filter.name);
    expect(filter.name).toMatch(/not required/i);
    expect(filter["timeout-minutes"]).toBeLessThanOrEqual(5);
    expect(filterRun).toContain("git diff --name-only HEAD^1 HEAD");
    expect(filterRun).toContain("pull_request");
  });
  it("pushes and manual runs always say 'changed', so they always run the job", () => {
    expect(filterRun).toMatch(/!= "pull_request"[\s\S]*changed=true/);
  });

  const embedFiles = [
    "src/app/embed/jobs/[orgId]/route.ts",
    "src/lib/embed/feature.ts",
    "src/lib/embed/widget-data.ts",
    "src/components/employer/job-widget-card.tsx",
    "src/lib/employer/widget-actions.ts",
    "src/app/employer/profile/page.tsx",
    "e2e/employer-job-widget.spec.ts",
    "e2e/qa-embed-long-token.spec.ts",
    "supabase/migrations/0237_employer_job_widget.sql",
    "scripts/ci/assert-embed-on-ran.ts",
    ".github/workflows/ci.yml",
  ];
  it("the path pattern matches every embed file named above, and every one of them exists in the repo", () => {
    expect(pattern, "no grep -Eq pattern in the filter job").not.toBe("");
    const re = new RegExp(pattern);
    const tracked = new Set(execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n"));
    for (const f of embedFiles) {
      expect(re.test(f), f).toBe(true);
      expect(tracked.has(f), `${f} must exist`).toBe(true);
    }
  });
  it("it does NOT match unrelated files (so an ordinary PR does not run the job)", () => {
    const re = new RegExp(pattern);
    for (const f of ["src/app/jobs/page.tsx", "src/lib/auth/actions.ts", "e2e/employer.spec.ts", "src/components/employer/campaign-form.tsx", "src/app/employer/jobs/page.tsx", "README.md", "tests/embed/embed-route.test.ts", "src/lib/embed-other/x.ts"]) {
      expect(re.test(f), f).toBe(false);
    }
  });
});

describe("the filter job fails open: any trouble with the diff means 'changed', so the embed job runs", () => {
  const filter = jobs["embed-widget-changes"];
  const diffStep = (filter?.steps ?? []).find((st) => st.id === "diff");
  const script = diffStep?.run ?? "";
  const checkout = (filter?.steps ?? []).find((st) => st.uses?.startsWith("actions/checkout")) as (Step & { with?: { "fetch-depth"?: number | string } }) | undefined;

  const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.email=a@b.c", "-c", "user.name=t", ...args], { encoding: "utf8" });
  /** Runs the REAL step script the way a runner does by default (bash -e, no pipefail), in a throwaway repo, and returns the value written to $GITHUB_OUTPUT. */
  function run(opts: { event: string; setup: (dir: string) => void; pathShim?: string }) {
    const dir = mkdtempSync(path.join(tmpdir(), "embedfilter-"));
    try {
      execFileSync("git", ["-C", dir, "init", "-q", "-b", "main"]);
      opts.setup(dir);
      const out = path.join(dir, ".gh-output");
      writeFileSync(out, "");
      let PATH = process.env.PATH ?? "";
      if (opts.pathShim) {
        const bin = path.join(dir, ".shim");
        mkdirSync(bin);
        writeFileSync(path.join(bin, "git"), opts.pathShim);
        chmodSync(path.join(bin, "git"), 0o755);
        PATH = `${bin}:${PATH}`;
      }
      const r = spawnSync("bash", ["-e", "-c", script], { cwd: dir, env: { ...process.env, PATH, GITHUB_EVENT_NAME: opts.event, GITHUB_OUTPUT: out }, encoding: "utf8" });
      return { exit: r.status, output: readFileSync(out, "utf8").trim() };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const commitFile = (dir: string, file: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), file);
    git(dir, "add", ".");
    git(dir, "commit", "-qm", file);
  };
  /** The merge commit a pull_request run checks out: the base is its first parent. */
  const mergeOf = (dir: string, changed: string) => {
    commitFile(dir, "README.md");
    git(dir, "checkout", "-qb", "pr");
    commitFile(dir, changed);
    git(dir, "checkout", "-q", "main");
    git(dir, "merge", "-q", "--no-ff", "pr", "-m", "merge");
  };

  it("(a) the checkout is deep enough for HEAD^1 on a pull_request merge checkout (fetch-depth 2 or more, or 0)", () => {
    const depth = Number(checkout?.with?.["fetch-depth"]);
    expect(Number.isNaN(depth), "fetch-depth must be set explicitly").toBe(false);
    expect(depth === 0 || depth >= 2).toBe(true);
  });

  it("(b1) the normal answers still hold: embed file changed -> true, unrelated -> false, push -> true", () => {
    expect(run({ event: "pull_request", setup: (d) => mergeOf(d, "src/lib/embed/feature.ts") }).output).toBe("changed=true");
    expect(run({ event: "pull_request", setup: (d) => mergeOf(d, "src/app/jobs/page.tsx") }).output).toBe("changed=false");
    expect(run({ event: "push", setup: (d) => mergeOf(d, "src/app/jobs/page.tsx") }).output).toBe("changed=true");
  });

  it("(b2) a pull_request checkout with NO parent commit (HEAD^1 does not exist): the diff fails, the answer is 'true', the step does not fail", () => {
    const r = run({ event: "pull_request", setup: (d) => commitFile(d, "README.md") });
    expect(r.output).toBe("changed=true");
    expect(r.exit).toBe(0);
  });

  it("(b3) git itself failing (any reason) is 'true', not a silent skip and not a red step", () => {
    const r = run({ event: "pull_request", setup: (d) => mergeOf(d, "src/app/jobs/page.tsx"), pathShim: "#!/bin/sh\necho 'fatal: simulated failure' >&2\nexit 128\n" });
    expect(r.output).toBe("changed=true");
    expect(r.exit).toBe(0);
  });

  it("(b4) the answer is written exactly once", () => {
    const r = run({ event: "pull_request", setup: (d) => commitFile(d, "README.md") });
    expect(r.output.split("\n")).toHaveLength(1);
  });
});
