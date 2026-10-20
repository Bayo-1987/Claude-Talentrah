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
    const warn = runs.findIndex((r) => r.includes("has_function_privilege"));
    expect(warn, "a step must check has_function_privilege and print ::warning::").toBeGreaterThanOrEqual(0);
    expect(runs[warn]).toContain("::warning::");
    expect(runs[warn]).not.toContain("::error::");
    expect(runs[warn]).not.toMatch(/exit\s+[1-9]/);
    expect(runs[warn]).toMatch(/exit 0\s*$/);
    expect(steps[warn].name ?? "", "the step name says it only warns").toMatch(/warn/i);
  });

  it("runs its steps in order: hold back, replay, switch, apply, request, the function warning, then the sequence warning", () => {
    const order = [
      indexOf("post-cutoff"), // the hold-back step moves the later migrations aside
      indexOf("start-supabase.sh"),
      indexOf("alter default privileges"),
      indexOf("supabase migration up"),
      runs.findIndex((r) => r.includes("/rest/v1/")),
      runs.findIndex((r) => r.includes("has_function_privilege")),
      runs.findIndex((r) => r.includes("has_sequence_privilege")),
    ];
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
  });
});

/*
 * PARITY WITH THE SHARED ACTION. The grants job replays the grandfathered migrations on a stack that must be the same stack the other jobs get, or a green result here
 * says nothing about them. The shared action (.github/actions/local-supabase/action.yml) sets, around start-supabase.sh: the CLI install (a commit-sha pin and
 * version 2.117.0), the start step (`shell: bash`, run from the workspace root, no arguments, no env, no with, no working-directory), and `supabase db reset` (the one
 * step this job deliberately does not run: it would only repeat the replay that `start` just did, before the switch). The script itself runs a plain `supabase start`
 * with no excluded service. These tests fail if the job's call stops matching on any of those points.
 */
describe("the grants job starts the stack the way the shared local-supabase action does", () => {
  const shared = action.runs.steps;
  const job = workflow.jobs["grants-new-rule"];
  const sharedInstall = shared.find((s) => s.uses?.startsWith("supabase/setup-cli@"));
  const sharedStart = shared.find((s) => s.run?.includes("start-supabase.sh"));
  const jobInstall = job?.steps?.find((s) => s.uses?.startsWith("supabase/setup-cli@"));
  const jobStart = job?.steps?.find((s) => s.run?.includes("start-supabase.sh"));
  const normal = (run: string | undefined) => (run ?? "").replace('"${{ github.action_path }}/start-supabase.sh"', ".github/actions/local-supabase/start-supabase.sh").trim();

  it("finds both start steps", () => {
    expect(sharedStart, "the shared action must still have a start step").toBeDefined();
    expect(jobStart, "the grants job must still have a start step").toBeDefined();
  });

  it("installs the same CLI: the same pinned action and the same with: block", () => {
    expect(jobInstall?.uses).toBe(sharedInstall?.uses);
    expect(jobInstall?.with).toEqual(sharedInstall?.with);
  });

  it("runs the same script the same way: bash, the same command line, no arguments", () => {
    expect(jobStart!.shell).toBe(sharedStart!.shell);
    expect(normal(jobStart!.run)).toBe(normal(sharedStart!.run));
    expect(normal(jobStart!.run)).toBe("bash .github/actions/local-supabase/start-supabase.sh");
    expect(existsSync(".github/actions/local-supabase/start-supabase.sh")).toBe(true);
  });

  it("sets nothing around the start that would change the stack: no env, with, working-directory or condition on either start step, and no job-level env but the cutoff", () => {
    for (const step of [sharedStart!, jobStart!]) {
      const extra = step as Step & Record<string, unknown>;
      for (const key of ["env", "with", "working-directory", "if", "continue-on-error", "timeout-minutes"]) expect(extra[key], `${key} on a start step`).toBeUndefined();
    }
    expect(Object.keys(job.env ?? {})).toEqual(["GRANTS_CUTOFF"]);
    expect((action as unknown as { inputs?: unknown }).inputs, "the shared action takes no inputs").toBeUndefined();
    expect((workflow as unknown as { defaults?: unknown }).defaults, "no workflow-level defaults (shell, working-directory)").toBeUndefined();
    expect((job as unknown as { defaults?: unknown }).defaults, "no job-level defaults (shell, working-directory)").toBeUndefined();
  });

  it("checks the repository out before the start, because the script lives in it", () => {
    const steps = job.steps ?? [];
    const checkout = steps.findIndex((s) => s.uses?.startsWith("actions/checkout@"));
    expect(checkout).toBeGreaterThanOrEqual(0);
    expect(checkout).toBeLessThan(steps.indexOf(jobStart!));
  });

  it("start-supabase.sh runs a plain `supabase start` with no excluded service and no skipped health check", () => {
    const script = readFileSync(".github/actions/local-supabase/start-supabase.sh", "utf8");
    const starts = script.split("\n").filter((l) => /\bsupabase start\b/.test(l) && !l.trim().startsWith("#") && !/echo|::/.test(l));
    expect(starts.map((l) => l.trim())).toEqual(['supabase start 2>&1 | tee "$log"']);
    expect(script).not.toMatch(/--exclude|--ignore-health-check|(^|\s)-x\s/m);
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
# The fake answers by the KINDS the query asks for, the way the real catalog would: a query that does not list 'v' (views) never sees a view.
case "$sql" in
  *"relkind in ("*)
    printf 'profiles\\nresumes\\n'
    case "$sql" in *"'v'"*) printf 'old_view\\n' ;; esac
    if [ -e "$RUNNER_TEMP/leg-applied" ]; then
      for t in \${NEW_TABLES:-}; do echo "$t"; done
      case "$sql" in *"'v'"*) for v in \${NEW_VIEWS:-}; do echo "$v"; done ;; esac
    fi ;;
  *has_function_privilege*) printf '%b' "\${LACKING_FUNCS:-}" ;;
  *has_sequence_privilege*) printf '%b' "\${LACKING_SEQS:-}" ;;
  *"relkind = 'S'"*) printf 'old_seq\\n'; [ -e "$RUNNER_TEMP/leg-applied" ] && for q in \${NEW_SEQS:-}; do echo "$q"; done ;;
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
    const before = (text = "profiles\nresumes\nold_view\n") => writeFileSync(path.join(dir, "rt/relations-before.txt"), text);

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

    it("FAILS when the list of relations captured before the migrations is missing (it must never pass without checking)", () => {
      workspace([]); applied(); // no relations-before.txt
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
      chmodSync(path.join(dir, "rt/relations-before.txt"), 0o000);
      // grep exits at once on the unreadable list without reading its input, so the writer in front of it can die of SIGPIPE, which also fails the step and would hide a
      // swallowed grep error. A wrapper that reads all its input first makes the outcome depend only on grep's own exit status.
      writeFileSync(path.join(dir, "bin/grep"), '#!/bin/bash\nin="$(cat)"\nPATH="$REAL_PATH" grep "$@" <<< "$in"\n');
      chmodSync(path.join(dir, "bin/grep"), 0o755);
      const r = run(request(), { NEW_TABLES: "bad_table", CURL_CODES: "bad_table=403", REAL_PATH: process.env.PATH ?? "" });
      expect(r.code, r.out).not.toBe(0);
    });


    // VIEWS. Supabase's new rule withholds automatic access from views, materialized views and foreign tables as well as tables, and PostgREST serves all of them.
    it("FAILS when a new VIEW has no grant (403), and says which one", () => {
      workspace([]); applied(); before();
      const r = run(request(), { NEW_VIEWS: "bad_view", CURL_CODES: "bad_view=403" });
      expect(r.code, r.out).not.toBe(0);
      expect(r.out).toContain("::error::public.bad_view is not reachable by service_role (HTTP 403)");
    });

    it("passes when a new VIEW has an explicit grant (200) and a new table does too", () => {
      workspace([]); applied(); before();
      const r = run(request(), { NEW_TABLES: "good_table", NEW_VIEWS: "good_view", CURL_CODES: "good_table=200,good_view=200" });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("ok   public.good_view");
      expect(r.out).toContain("ok   public.good_table");
    });

    it("a view that already existed before the migrations is not checked, because the before-list is captured with the same kinds (the switch step is run for real)", () => {
      workspace([]);
      const sw = run(stepNamed("Switch to the new rule"));
      expect(sw.code, sw.out).toBe(0);
      applied();
      const r = run(request(), { NEW_VIEWS: "good_view", CURL_CODES: "old_view=403,good_view=200" });
      expect(r.code, r.out).toBe(0);
      expect(r.out).not.toContain("old_view");
      expect(r.out).toContain("ok   public.good_view");
    });

    it("lists tables and views by the same kinds before and after (r, p, v, m, f), so a kind added to one side cannot go missing from the other", () => {
      const sw = stepNamed("Switch to the new rule").run!;
      const rq = request().run!;
      const KINDS = "relkind in ('r','p','v','m','f')";
      expect(sw.split(KINDS).length - 1, "the switch step captures the before-list with all five kinds").toBe(1);
      expect(rq.split(KINDS).length - 1, "the request step reads the after-list with all five kinds").toBe(1);
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

  describe("the switch step captures the lists the later steps compare against", () => {
    it("writes the relations (tables and views), the functions and the sequences that exist before the migrations", () => {
      workspace([]);
      const r = run(stepNamed("Switch to the new rule"));
      expect(r.code, r.out).toBe(0);
      expect(readFileSync(path.join(dir, "rt/relations-before.txt"), "utf8")).toBe("profiles\nresumes\nold_view\n");
      expect(readFileSync(path.join(dir, "rt/sequences-before.txt"), "utf8")).toBe("old_seq\n");
      expect(existsSync(path.join(dir, "rt/functions-before.txt"))).toBe(true);
      expect(r.out).toContain("public sequences before the switch: 1");
    });
  });

  describe("the sequence step can never fail the job", () => {
    const warn = () => stepNamed("Warn about sequences");
    const applied = () => writeFileSync(path.join(dir, "rt/leg-applied"), "");
    const before = (text = "old_seq\n") => writeFileSync(path.join(dir, "rt/sequences-before.txt"), text);

    it("is marked continue-on-error, turns the runner's errexit off itself and ends in exit 0", () => {
      expect(warn()["continue-on-error"], "continue-on-error: true must stay on the step").toBe(true);
      expect(warn().run).toMatch(/^\s*set \+e\s*$/m);
      expect(warn().run).toMatch(/exit 0\s*$/);
      expect(warn().run).not.toContain("::error::");
      expect(warn().run).not.toMatch(/exit\s+[1-9]/);
    });

    // Found only by a run against a real database: has_sequence_privilege errors on any relation that is not a sequence, and the planner may apply it before
    // `relkind = 'S'`. A fake database cannot show that, so the guard is pinned here by its text.
    it("guards has_sequence_privilege with a CASE on relkind, so it is never evaluated on a table or an index", () => {
      expect(squash(warn().run!)).toContain("case when c.relkind = 'S' then not has_sequence_privilege('service_role', c.oid, 'usage') end");
    });

    it("prints a warning for a new sequence that service_role cannot use, and still exits 0", () => {
      workspace([]); applied(); before();
      const r = run(warn(), { LACKING_SEQS: "old_seq\nnew_seq\n" });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("::warning::sequence public.new_seq");
      expect(r.out).not.toContain("public.old_seq");
    });

    it("stays silent (no warning) when no new sequence lacks USAGE", () => {
      workspace([]); applied(); before();
      const r = run(warn(), { LACKING_SEQS: "old_seq\n" });
      expect(r.code, r.out).toBe(0);
      expect(r.out).not.toContain("::warning::");
      expect(r.out).toContain("no sequence created after the cutoff lacks USAGE for service_role");
    });

    it("checks against an EMPTY list of earlier sequences (a database with none yet is not a reason to skip)", () => {
      workspace([]); applied(); before("");
      const r = run(warn(), { LACKING_SEQS: "first_seq\n" });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("::warning::sequence public.first_seq");
    });

    it("is skipped, and exits 0, when no migration was applied after the cutoff", () => {
      workspace([]); before();
      const r = run(warn(), { LACKING_SEQS: "new_seq\n" });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("skipped: no migration after 0263");
      expect(r.out).not.toContain("::warning::");
    });

    it("exits 0 when the database query fails", () => {
      workspace([]); applied(); before();
      const r = run(warn(), { FAKE_DOCKER_FAIL: "1" });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("::warning::the sequence check was skipped");
    });

    it("exits 0 when supabase/config.toml is missing", () => {
      workspace([], { config: false }); applied(); before();
      const r = run(warn());
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("::warning::the sequence check was skipped");
    });

    it("exits 0 when the list of sequences captured before the migrations is missing", () => {
      workspace([]); applied(); // no sequences-before.txt
      const r = run(warn(), { LACKING_SEQS: "new_seq\n" });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("::warning::the sequence check was skipped");
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
