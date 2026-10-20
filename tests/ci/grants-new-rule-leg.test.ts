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
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = { name?: string; uses?: string; run?: string; shell?: string; "continue-on-error"?: boolean; with?: Record<string, string> };
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


/*
 * THE JOB'S SHELL, RUN FOR REAL. These tests run the `run:` blocks of the job with bash exactly as the GitHub runner starts a `shell: bash` step
 * (`bash --noprofile --norc -e -o pipefail <script>`), inside a temporary directory, with small fake `docker`, `supabase` and `curl` programs on the path
 * (the fakes answer from environment variables). They exist because two things the YAML tests above cannot see went wrong in review: the runner's `-e` is
 * on for every step, whatever the script's own first line says, and a missing input file made a check pass without checking anything.
 */
const jobSteps = (): Step[] => workflow.jobs["grants-new-rule"]?.steps ?? [];
const stepNamed = (start: string): Step => {
  const step = jobSteps().find((s) => s.name?.startsWith(start));
  if (!step?.run) throw new Error(`the job has no run step whose name starts with "${start}"`);
  return step;
};

describe("the job's shell, run for real", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  const FAKE_DOCKER = `#!/bin/bash
[ "\${FAKE_DOCKER_FAIL:-0}" = 1 ] && { echo "fake docker: failing on purpose" >&2; exit 1; }
sql=""; args=("$@"); for ((i=0; i<\${#args[@]}; i++)); do [ "\${args[$i]}" = "-c" ] && sql="\${args[$((i+1))]}"; done
if [ -z "$sql" ]; then cat > /dev/null; exit 0; fi
case "$sql" in
  *"relkind in ('r','p')"*) printf 'profiles\\nresumes\\n'; [ -e "$RUNNER_TEMP/leg-applied" ] && for t in \${NEW_TABLES:-}; do echo "$t"; done ;;
  *has_function_privilege*) printf '%b' "\${LACKING_FUNCS:-}" ;;
  *"notify pgrst"*) : ;;
  *) : ;;
esac
exit 0
`;
  const FAKE_SUPABASE = `#!/bin/bash
case "$1 $2" in
  "status -o") printf 'API_URL=http://127.0.0.1:1\\nSERVICE_ROLE_KEY=fake-key\\n' ;;
  *) : ;;
esac
exit 0
`;
  const FAKE_CURL = `#!/bin/bash
url="\${@: -1}"; t="\${url#*/rest/v1/}"; t="\${t%%\\?*}"
code=200; IFS=',' read -ra pairs <<< "\${CURL_CODES:-}"; for p in "\${pairs[@]}"; do [ "\${p%%=*}" = "$t" ] && code="\${p#*=}"; done
printf '%s' "$code"
`;

  /** A scratch workspace: supabase/config.toml, the given migration files, a runner temp directory, and the fakes. */
  function workspace(files: string[], opts: { config?: boolean } = {}) {
    dir = mkdtempSync(path.join(tmpdir(), "grants-leg-"));
    mkdirSync(path.join(dir, "ws/supabase/migrations"), { recursive: true });
    mkdirSync(path.join(dir, "rt"), { recursive: true });
    mkdirSync(path.join(dir, "bin"), { recursive: true });
    for (const f of files) writeFileSync(path.join(dir, "ws/supabase/migrations", f), "-- fixture\n");
    if (opts.config !== false) writeFileSync(path.join(dir, "ws/supabase/config.toml"), 'project_id = "fixture"\n');
    for (const [name, body] of [["docker", FAKE_DOCKER], ["supabase", FAKE_SUPABASE], ["curl", FAKE_CURL]] as const) {
      writeFileSync(path.join(dir, "bin", name), body);
      chmodSync(path.join(dir, "bin", name), 0o755);
    }
    return dir;
  }

  /** Runs one step's script the way the runner does. */
  function run(step: Step, env: Record<string, string> = {}) {
    const script = path.join(dir, "step.sh");
    writeFileSync(script, step.run!);
    const r = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", script], {
      cwd: path.join(dir, "ws"),
      env: { PATH: `${path.join(dir, "bin")}:${process.env.PATH}`, RUNNER_TEMP: path.join(dir, "rt"), GRANTS_CUTOFF: "0263", ...env } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  const migrations = () => readdirSync(path.join(dir, "ws/supabase/migrations")).sort();
  const heldBack = () => (existsSync(path.join(dir, "rt/post-cutoff")) ? readdirSync(path.join(dir, "rt/post-cutoff")).sort() : []);

  describe("the cutoff comparison (numeric, on the first four digits of the file name, .sql files only)", () => {
    const FILES = ["0000_baseline.sql", "0262_a.sql", "0263_b.sql", "0264_c.sql", "20261101120000_timestamped.sql", "README.md", "notes.txt", "draft.sql", "9999_last.sql"];

    it("0263 is NOT checked, 0264 IS, and a file that is not a numbered migration is ignored", () => {
      workspace(FILES);
      const r = run(stepNamed("Hold back"));
      expect(r.code, r.out).toBe(0);
      expect(heldBack()).toEqual(["0264_c.sql", "20261101120000_timestamped.sql", "9999_last.sql"]);
      expect(migrations()).toEqual(["0000_baseline.sql", "0262_a.sql", "0263_b.sql", "README.md", "draft.sql", "notes.txt"]);
      expect(r.out).toContain("held back 3 migration(s) numbered after 0263");
      expect(r.out, "no arithmetic error from a file that is not a migration").not.toMatch(/value too great|syntax error|invalid/i);
    });

    it("holds nothing back, and says so, when no migration follows the cutoff", () => {
      workspace(["0262_a.sql", "0263_b.sql", "README.md"]);
      const r = run(stepNamed("Hold back"));
      expect(r.code, r.out).toBe(0);
      expect(heldBack()).toEqual([]);
      expect(r.out).toContain("held back 0 migration(s) numbered after 0263");
    });

    it("does not fail when the migrations folder holds no .sql file at all", () => {
      workspace(["README.md"]);
      expect(run(stepNamed("Hold back")).code).toBe(0);
    });
  });

  describe("the service_role request step fails closed", () => {
    const request = () => stepNamed("service_role can reach");
    const applied = () => writeFileSync(path.join(dir, "rt/leg-applied"), "");
    const before = (text = "profiles\nresumes\n") => writeFileSync(path.join(dir, "rt/tables-before.txt"), text);

    it("passes when every new table answers 200", () => {
      workspace([]); applied(); before();
      const r = run(request(), { NEW_TABLES: "good_table", CURL_CODES: "good_table=200" });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("ok   public.good_table");
    });

    it("fails when a new table is refused (403)", () => {
      workspace([]); applied(); before();
      const r = run(request(), { NEW_TABLES: "bad_table", CURL_CODES: "bad_table=403" });
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("::error::public.bad_table is not reachable by service_role (HTTP 403)");
    });

    it("FAILS when the list of tables captured before the migrations is missing (it must never pass without checking)", () => {
      workspace([]); applied(); // no tables-before.txt
      const r = run(request(), { NEW_TABLES: "bad_table", CURL_CODES: "bad_table=403" });
      expect(r.code, r.out).not.toBe(0);
      expect(r.out).toContain("::error::");
    });

    it("FAILS when the list is empty (an empty list cannot tell old tables from new ones, even if every request would answer 200)", () => {
      workspace([]); applied(); before("");
      const r = run(request(), { NEW_TABLES: "good_table" });
      expect(r.code, r.out).not.toBe(0);
      expect(r.out).toContain("::error::");
    });

    // An unreadable list makes `grep -f` exit 2 (an error), which must not be mistaken for "no new table". A root user can read any file, so this cannot be shown there.
    it.skipIf(process.getuid?.() === 0)("FAILS when grep itself errors on the list (an error is not the same as no new table)", () => {
      workspace([]); applied(); before();
      chmodSync(path.join(dir, "rt/tables-before.txt"), 0o000);
      // grep exits at once on the unreadable list without reading its input, so the writer in front of it can die of SIGPIPE, which also fails the step and would hide a
      // swallowed grep error. A wrapper that reads all its input first makes the outcome depend only on grep's own exit status.
      writeFileSync(path.join(dir, "bin/grep"), '#!/bin/bash\nin="$(cat)"\nPATH="$REAL_PATH" grep "$@" <<< "$in"\n');
      chmodSync(path.join(dir, "bin/grep"), 0o755);
      const r = run(request(), { NEW_TABLES: "bad_table", CURL_CODES: "bad_table=403", REAL_PATH: process.env.PATH ?? "" });
      expect(r.code, r.out).not.toBe(0);
    });

    it("is skipped, and passes, when no migration was applied after the cutoff", () => {
      workspace([]); before();
      const r = run(request());
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("skipped: no migration after 0263");
    });
  });

  describe("the function step can never fail the job", () => {
    const warn = () => stepNamed("Warn about functions");
    const applied = () => writeFileSync(path.join(dir, "rt/leg-applied"), "");
    const before = () => writeFileSync(path.join(dir, "rt/functions-before.txt"), "old_fn()\n");

    it("is marked continue-on-error and turns the runner's errexit off itself", () => {
      expect(warn()["continue-on-error"], "continue-on-error: true must stay on the step").toBe(true);
      expect(warn().run).toMatch(/^\s*set \+e\s*$/m);
      expect(warn().run).toMatch(/exit 0\s*$/);
    });

    it("prints a warning for a new function that service_role cannot execute, and still exits 0", () => {
      workspace([]); applied(); before();
      const r = run(warn(), { LACKING_FUNCS: "old_fn()\\nnew_fn(integer)\\n" });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("::warning::function public.new_fn(integer)");
      expect(r.out).not.toContain("public.old_fn()");
    });

    it("exits 0 when there is nothing to warn about", () => {
      workspace([]); applied(); before();
      const r = run(warn(), { LACKING_FUNCS: "old_fn()\\n" });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("no function created after the cutoff lacks EXECUTE for service_role");
    });

    it("exits 0 when the database query fails", () => {
      workspace([]); applied(); before();
      const r = run(warn(), { FAKE_DOCKER_FAIL: "1" });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("::warning::the function check was skipped");
    });

    it("exits 0 when supabase/config.toml is missing", () => {
      workspace([], { config: false }); applied(); before();
      const r = run(warn());
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("::warning::the function check was skipped");
    });

    it("exits 0 when the list of functions captured before the migrations is missing", () => {
      workspace([]); applied(); // no functions-before.txt
      const r = run(warn(), { LACKING_FUNCS: "new_fn(integer)\\n" });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("::warning::the function check was skipped");
    });
  });
});

describe("every use of supabase/setup-cli under .github is pinned to a commit", () => {
  /** The spike workflow is manual-only (workflow_dispatch) and deliberately runs `latest`; the owner kept it out of this change. It is the one named exception. */
  const EXCEPTIONS = [".github/workflows/local-supabase-spike.yml"];

  function filesUnder(dirPath: string): string[] {
    return readdirSync(dirPath, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dirPath, e.name)) : [path.join(dirPath, e.name)]));
  }
  const uses = filesUnder(".github")
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((f) => [...readFileSync(f, "utf8").matchAll(/^\s*(?:-\s*)?uses:\s*supabase\/setup-cli@(\S+)/gm)].map((m) => ({ file: f.split(path.sep).join("/"), ref: m[1] })));

  it("finds the installs it is meant to guard", () => {
    expect(uses.map((u) => u.file)).toEqual(expect.arrayContaining([".github/actions/local-supabase/action.yml", ".github/workflows/ci.yml"]));
  });

  it("pins each one to a 40-hex commit, except the named manual-only spike", () => {
    const unpinned = [...new Set(uses.filter((u) => !/^[0-9a-f]{40}$/.test(u.ref)).map((u) => u.file))].sort();
    expect(unpinned, "an unpinned supabase/setup-cli use (a tag or a branch moves); pin it to a 40-hex sha").toEqual(EXCEPTIONS);
  });

  it("uses no moving @v1 anywhere", () => {
    expect(uses.filter((u) => u.ref === "v1")).toEqual([]);
  });
});
