/**
 * The post-cutoff grants leg.
 *
 * From 2026-10-30 Supabase stops granting new tables to anon, authenticated and service_role on existing projects too. The existing CI jobs replay every
 * migration under the OLD default, so a new table that forgets its grants still works there and CI stays green. The `grants-new-rule` job replays only the
 * grandfathered migrations (numbered up to GRANTS_CUTOFF) under the old default, switches the default privileges with the statements Supabase publishes for
 * opting in early, then applies every later migration and checks service_role can reach each new table.
 *
 * These tests pin the parts that must not drift quietly: the config key, the CLI install, the shape of the job. The job's behaviour is proved by running its
 * steps against a real stack (see the report that came with it); here only the files are read.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, string> };
type Job = { name?: string; "timeout-minutes"?: number; needs?: unknown; if?: unknown; paths?: unknown; env?: Record<string, string>; steps?: Step[] };
type Trigger = { paths?: unknown; "paths-ignore"?: unknown; branches?: unknown };

const read = (file: string) => readFileSync(file, "utf8");
const workflow = parse(read(".github/workflows/ci.yml")) as { on: Record<string, Trigger | null>; jobs: Record<string, Job> };
const action = parse(read(".github/actions/local-supabase/action.yml")) as { runs: { steps: Step[] } };
const config = read("supabase/config.toml");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The two statements as Supabase publishes them (changelog 45329, "Opting in on existing projects"), on one line each. */
const PUBLISHED = [
  "alter default privileges for role postgres in schema public revoke select, insert, update, delete on tables from anon, authenticated, service_role;",
  "alter default privileges for role postgres in schema public revoke usage, select on sequences from anon, authenticated, service_role;",
];

const SHA_PIN = /^supabase\/setup-cli@[0-9a-f]{40}$/;

describe("supabase/config.toml pins the old default for the replay of the existing migrations", () => {
  it("sets auto_expose_new_tables = true, uncommented", () => {
    expect(config).toMatch(/^auto_expose_new_tables\s*=\s*true\s*$/m);
  });

  it("never sets it to false (that makes the replay abort at migration 0211)", () => {
    expect(config).not.toMatch(/^auto_expose_new_tables\s*=\s*false\s*$/m);
  });
});

describe("the local-supabase action pins the CLI install", () => {
  const install = () => action.runs.steps.find((s) => s.uses?.startsWith("supabase/setup-cli@"));

  it("pins supabase/setup-cli to a 40-hex commit sha, not a branch or a tag", () => {
    expect(install(), "the install step must still use supabase/setup-cli").toBeDefined();
    expect(install()!.uses).toMatch(SHA_PIN);
  });

  it("keeps the CLI version at 2.117.0", () => {
    expect(install()!.with?.version).toBe("2.117.0");
  });
});

describe("ci.yml has the grants-new-rule job", () => {
  const job = workflow.jobs["grants-new-rule"];
  const steps = job?.steps ?? [];
  const runs = steps.map((s) => s.run ?? "");
  const allRuns = squash(runs.join("\n"));
  const indexOf = (needle: string) => runs.findIndex((r) => r.includes(needle));

  it("exists, with the cutoff 0263", () => {
    expect(job, "ci.yml needs a job named grants-new-rule").toBeDefined();
    expect(job.env?.GRANTS_CUTOFF).toBe("0263");
  });

  it("has a job time limit", () => {
    expect(typeof job?.["timeout-minutes"]).toBe("number");
    expect(job["timeout-minutes"]!).toBeGreaterThanOrEqual(5);
    expect(job["timeout-minutes"]!).toBeLessThanOrEqual(30);
  });

  it("switches the default privileges with the two statements exactly as Supabase publishes them", () => {
    for (const statement of PUBLISHED) expect(allRuns, statement).toContain(statement);
  });

  it("installs the CLI with the same sha pin and version as the shared action", () => {
    const install = steps.find((s) => s.uses?.startsWith("supabase/setup-cli@"));
    expect(install, "the job needs its own CLI install step").toBeDefined();
    expect(install!.uses).toMatch(SHA_PIN);
    expect(install!.with?.version).toBe("2.117.0");
  });

  it("has no paths filter, no condition and no needs, so a required check always runs", () => {
    expect(job).toBeDefined();
    expect(job.paths).toBeUndefined();
    expect(job.if).toBeUndefined();
    expect(job.needs).toBeUndefined();
    for (const [event, trigger] of Object.entries(workflow.on)) {
      expect(trigger?.paths, `on.${event}.paths would let the workflow skip`).toBeUndefined();
      expect(trigger?.["paths-ignore"], `on.${event}.paths-ignore would let the workflow skip`).toBeUndefined();
    }
  });

  it("makes a real Data API request as service_role against every table created after the cutoff, and fails the job when one is refused", () => {
    const request = runs.findIndex((r) => r.includes("/rest/v1/") && r.includes("SERVICE_ROLE_KEY"));
    expect(request, "a step must call /rest/v1/ with the service_role key").toBeGreaterThanOrEqual(0);
    expect(runs[request]).toContain("exit $fail");
    expect(runs[request]).toContain("::error::");
  });

  it("says so, plainly, when no migration follows the cutoff", () => {
    expect(allRuns).toContain("nothing to check yet; the first migration after $GRANTS_CUTOFF will be the first real test");
  });

  it("has a warning-only step for functions that never fails the job", () => {
    const warn = runs.findIndex((r) => r.includes("::warning::"));
    expect(warn, "a step must print ::warning::").toBeGreaterThanOrEqual(0);
    expect(runs[warn]).not.toContain("::error::");
    expect(runs[warn]).not.toMatch(/exit\s+[1-9]/);
    expect(runs[warn]).toMatch(/exit 0\s*$/);
    expect(steps[warn].name ?? "", "the step name says it only warns").toMatch(/warn/i);
  });

  it("runs its steps in order: hold back, replay, switch, apply, request, then the function warning", () => {
    const order = [
      indexOf("post-cutoff"), // the hold-back step moves the later migrations aside
      indexOf("start-supabase.sh"),
      indexOf("alter default privileges"),
      indexOf("supabase migration up"),
      runs.findIndex((r) => r.includes("/rest/v1/")),
      runs.findIndex((r) => r.includes("::warning::")),
    ];
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
  });
});
