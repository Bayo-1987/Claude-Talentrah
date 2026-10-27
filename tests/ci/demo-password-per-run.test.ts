/**
 * CI-DEMO-PASSWORD (FIX-CI-DEMO-PASSWORD-1): the demo account's password in CI is a per-run random value that exists only in that job's own throwaway database.
 *
 * WHY. Playwright keeps a trace of every failing test and CI uploads the traces, the blob report and the HTML report as artifacts for 7 days. A trace records what a spec typed into the
 * login form, and GitHub's log masking does not reach inside an uploaded file. While the password was the repository secret DEMO_PASSWORD, a failing login spec put a long-lived credential
 * into a file anyone signed in to GitHub could download. Now there is no such secret in any CI workflow: `npm run seed` (scripts/seed.ts, resolveDemoPassword) makes a fresh 48-hex value in
 * each job that seeds, masks it, and exports it to the steps after it through $GITHUB_ENV; the specs read it from the environment as before; it dies with the job's database.
 *
 * WHAT IS PINNED (the numbers are the checks in the task):
 *   1. no workflow or action references secrets.DEMO_PASSWORD;
 *   2. no workflow defines DEMO_PASSWORD in an env: map (workflow, job or step level) - one named exemption, the hand-run spike, which is pinned to be manual-only and local-only;
 *   3. the seed function: with CI and nothing set it generates a 48-hex value, prints ::add-mask::<value> BEFORE it writes the value to $GITHUB_ENV, no other line carries the value, and
 *      two calls differ;
 *   4. a value that is set is used as it is, and nothing is written; outside CI with nothing set there is no value;
 *   5. an empty string counts as not set (a secret withheld from a Dependabot run is an empty string, not an absent key);
 *   6. no e2e file assigns DEMO_PASSWORD from anything but the environment, and none fills the demo account's password with a literal;
 *   7. no workflow `run:` script mentions DEMO_PASSWORD at all (so nothing can echo it);
 *   8. importing scripts/seed.ts seeds nothing (it is imported lazily here, so each check fails on its own), and the real program (`tsx scripts/seed.ts`) still starts, masks, exports and then stops at the missing database (no network);
 * plus the wiring: which jobs seed, and that the steps that read the generated value come after the seed step.
 *
 * No assertion message here prints a value: comparisons are reduced to booleans first.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

const ROOT = path.join(__dirname, "../..");

/*
 * scripts/seed.ts is imported lazily, once, with process.exit and console.error watched: a file that seeds as a side effect of being imported would fail here, per check, instead of
 * taking the whole file down at load. `resolveDemoPassword` is filled in by the describes that need it.
 */
type SeedModule = typeof import("../../scripts/seed");
let seedLoad: Promise<{ mod: SeedModule; exitCalls: number; errCalls: number }> | undefined;
function loadSeed() {
  seedLoad ??= (async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const mod = await import("../../scripts/seed");
      await new Promise((r) => setTimeout(r, 100));
      return { mod, exitCalls: exit.mock.calls.length, errCalls: err.mock.calls.length };
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
  })();
  return seedLoad;
}
/** The function under test, or a failure that says why (the file does not load, or does not export it). Each check awaits this itself, so each fails on its own. */
async function seedFn(): Promise<SeedModule["resolveDemoPassword"]> {
  const fn = (await loadSeed()).mod.resolveDemoPassword;
  if (typeof fn !== "function") throw new Error("scripts/seed.ts does not export resolveDemoPassword");
  return fn;
}

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** The one workflow allowed to define DEMO_PASSWORD, and why. Pinned below to be manual-only and local-only. */
const EXEMPT: Record<string, string> = {
  "local-supabase-spike.yml": "a hand-run feasibility spike on its own local stack with a throwaway placeholder; it never runs on a push or a pull request",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}
const workflowFiles = () => walk(".github/workflows").filter((f) => /\.ya?ml$/.test(f));
const actionFiles = () => walk(".github/actions").filter((f) => /\.ya?ml$/.test(f));
const baseName = (f: string) => path.basename(f);

type Step = { name?: string; run?: string; uses?: string; env?: Record<string, unknown> };
type Job = { name?: string; env?: Record<string, unknown>; steps?: Step[] };
type Workflow = { on?: unknown; env?: Record<string, unknown>; jobs?: Record<string, Job> };
const doc = (rel: string): Workflow => parse(read(rel)) as Workflow;

/** Every place in a workflow that defines DEMO_PASSWORD in an env map: workflow, job and step level. Returns locations only. */
function envDefinitions(w: Workflow): string[] {
  const hits: string[] = [];
  if (w.env && "DEMO_PASSWORD" in w.env) hits.push("workflow env");
  for (const [jobId, job] of Object.entries(w.jobs ?? {})) {
    if (job.env && "DEMO_PASSWORD" in job.env) hits.push(`job ${jobId} env`);
    (job.steps ?? []).forEach((s, i) => {
      if (s.env && "DEMO_PASSWORD" in s.env) hits.push(`job ${jobId} step ${i + 1} env`);
    });
  }
  return hits;
}
const SECRET_REF = /secrets\s*(?:\.|\[\s*['"])\s*DEMO_PASSWORD/;

describe("1. no workflow or action reads the repository secret DEMO_PASSWORD", () => {
  it("not as an expression, in any form, in any workflow or action file (comments included: a commented-out line comes back with one keystroke)", () => {
    const offenders = [...workflowFiles(), ...actionFiles()].filter((f) => SECRET_REF.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe("2. no workflow defines DEMO_PASSWORD in an env map", () => {
  it("none of them, except the named exemption (workflow, job and step level, any value)", () => {
    const offenders = workflowFiles()
      .filter((f) => !(baseName(f) in EXEMPT))
      .flatMap((f) => envDefinitions(doc(f)).map((where) => `${baseName(f)}: ${where}`));
    expect(offenders).toEqual([]);
  });
  it("ci.yml in particular, the workflow that runs on every push and pull request", () => {
    expect(envDefinitions(doc(".github/workflows/ci.yml"))).toEqual([]);
  });
  it("the exemption is real and narrow: every exempt file exists, runs only by hand, and starts its own local stack", () => {
    for (const name of Object.keys(EXEMPT)) {
      const file = `.github/workflows/${name}`;
      const w = doc(file);
      expect(Object.keys((w.on ?? {}) as object), `${name} triggers`).toEqual(["workflow_dispatch"]);
      const usesLocalStack = Object.values(w.jobs ?? {}).some((j) => (j.steps ?? []).some((s) => s.uses === "./.github/actions/local-supabase" || /\bsupabase\s+start\b/.test(s.run ?? "")));
      expect(usesLocalStack, `${name} must start its own local stack`).toBe(true);
    }
  });
});

describe("3. the seed's CI fallback: generated, masked first, exported, and nowhere else", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmpEnvFile = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "demo-pw-"));
    dirs.push(dir);
    const file = path.join(dir, "github_env");
    writeFileSync(file, "");
    return file;
  };

  it("CI with nothing set: a 48-hex value, a mask line carrying it, the same value exported as DEMO_PASSWORD=...", async () => {
    const resolveDemoPassword = await seedFn();
    const file = tmpEnvFile();
    const lines: string[] = [];
    const value = resolveDemoPassword({ CI: "true", GITHUB_ENV: file }, { log: (l) => lines.push(l) });
    expect(typeof value === "string" && /^[0-9a-f]{48}$/.test(value)).toBe(true);
    const mask = lines.filter((l) => l.startsWith("::add-mask::"));
    expect(mask).toHaveLength(1);
    expect(mask[0] === `::add-mask::${value}`).toBe(true);
    expect(readFileSync(file, "utf8") === `DEMO_PASSWORD=${value}\n`).toBe(true);
  });

  it("the mask is registered BEFORE the value is written anywhere (ordering, with a recording writer)", async () => {
    const resolveDemoPassword = await seedFn();
    const events: string[] = [];
    const value = resolveDemoPassword(
      { CI: "true", GITHUB_ENV: "/dev/null" },
      { log: (l) => events.push(l.startsWith("::add-mask::") ? "mask" : "log"), append: () => events.push("append") },
    );
    expect(typeof value).toBe("string");
    expect(events.indexOf("mask")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("append")).toBeGreaterThan(events.indexOf("mask"));
  });

  it("no log line other than the mask line carries the value", async () => {
    const resolveDemoPassword = await seedFn();
    const lines: string[] = [];
    const value = resolveDemoPassword({ CI: "true", GITHUB_ENV: "/dev/null" }, { log: (l) => lines.push(l), append: () => {} })!;
    const carriers = lines.filter((l) => l.includes(value));
    expect(carriers).toHaveLength(1);
    expect(carriers[0].startsWith("::add-mask::")).toBe(true);
    expect(lines.length).toBeGreaterThan(1); // the notice is still printed, without the value
  });

  it("two runs give two different values", async () => {
    const resolveDemoPassword = await seedFn();
    const quiet = { log: () => {}, append: () => {} };
    const a = resolveDemoPassword({ CI: "true" }, quiet);
    const b = resolveDemoPassword({ CI: "true" }, quiet);
    expect(a !== undefined && b !== undefined && a !== b).toBe(true);
  });

  it("with no GITHUB_ENV (a CI-like run outside GitHub) it still masks and returns a value, and writes no file", async () => {
    const resolveDemoPassword = await seedFn();
    const lines: string[] = [];
    const appended: string[] = [];
    const value = resolveDemoPassword({ CI: "true" }, { log: (l) => lines.push(l), append: (f) => appended.push(f) });
    expect(typeof value).toBe("string");
    expect(appended).toHaveLength(0);
    expect(lines.some((l) => l.startsWith("::add-mask::"))).toBe(true);
  });
});

describe("4. a value that is set is used as it is", () => {
  it("returned unchanged, nothing logged, nothing written", async () => {
    const resolveDemoPassword = await seedFn();
    const lines: string[] = [];
    const appended: string[] = [];
    const given = ["a", "b", "c", "d", "e", "f"].join("-") + "-" + String(Date.now());
    const out = resolveDemoPassword({ CI: "true", DEMO_PASSWORD: given, GITHUB_ENV: "/dev/null" }, { log: (l) => lines.push(l), append: (f) => appended.push(f) });
    expect(out === given).toBe(true);
    expect(lines).toEqual([]);
    expect(appended).toEqual([]);
  });
  it("outside CI with nothing set there is no value (the caller throws, as before): nothing is invented, logged or written", async () => {
    const resolveDemoPassword = await seedFn();
    const lines: string[] = [];
    const appended: string[] = [];
    expect(resolveDemoPassword({}, { log: (l) => lines.push(l), append: (f) => appended.push(f) })).toBeUndefined();
    expect(resolveDemoPassword({ GITHUB_ENV: "/dev/null" }, { log: (l) => lines.push(l), append: (f) => appended.push(f) })).toBeUndefined();
    expect(lines).toEqual([]);
    expect(appended).toEqual([]);
  });
});

describe("5. an empty string is not a value", () => {
  it("DEMO_PASSWORD='' in CI (a secret withheld from a Dependabot run) takes the generated path, exactly like an absent key", async () => {
    const resolveDemoPassword = await seedFn();
    const quiet = { log: () => {}, append: () => {} };
    const empty = resolveDemoPassword({ CI: "true", DEMO_PASSWORD: "" }, quiet);
    const absent = resolveDemoPassword({ CI: "true" }, quiet);
    expect(typeof empty === "string" && /^[0-9a-f]{48}$/.test(empty)).toBe(true);
    expect(typeof absent === "string" && /^[0-9a-f]{48}$/.test(absent)).toBe(true);
  });
  it("and outside CI an empty string is still 'not set'", async () => {
    const resolveDemoPassword = await seedFn();
    expect(resolveDemoPassword({ DEMO_PASSWORD: "" }, { log: () => {}, append: () => {} })).toBeUndefined();
  });
});

/** Reports what is wrong in one e2e file without ever returning a value. */
function scanSpec(text: string, demoEmail: string): string[] {
  const problems: string[] = [];
  const lines = text.split("\n");
  lines.forEach((l, i) => {
    // an assignment to DEMO_PASSWORD that is not a read of the environment
    const rhs = /\bDEMO_PASSWORD\b\s*(?::[^=]+)?=(?!=)\s*(\S.*)$/.exec(l)?.[1];
    if (rhs !== undefined && !/^process\.env\.DEMO_PASSWORD\b/.test(rhs)) problems.push(`line ${i + 1}: DEMO_PASSWORD is assigned from something other than the environment`);
    // the demo account's email typed, then the password field filled with a quoted literal within the next three lines
    if (l.includes(".fill(") && (l.includes(demoEmail) || /\bDEMO_EMAIL\b/.test(l))) {
      for (let k = i + 1; k <= Math.min(i + 3, lines.length - 1); k++) {
        if (/assword[^\n]*\.fill\(\s*["'`][^"'`]+["'`]\s*\)/.test(lines[k])) problems.push(`line ${k + 1}: the demo account's password field is filled with a literal`);
      }
    }
  });
  return problems;
}

describe("6. no e2e file hard-codes the demo account's password", () => {
  const demoEmail = /const DEMO_EMAIL = "([^"]+)"/.exec(read("scripts/seed.ts"))![1];
  const specFiles = walk("e2e").filter((f) => /\.ts$/.test(f));

  it("the scanner finds nothing in any e2e file", () => {
    const offenders = specFiles.flatMap((f) => scanSpec(read(f), demoEmail).map((p) => `${f} ${p}`));
    expect(offenders).toEqual([]);
  });
  it("and it can see the two mistakes it exists for (synthetic snippets built at run time, no value of ours)", () => {
    const lit = ["x", "y", "z", "q", "w", "k", "m"].join("");
    expect(scanSpec(`const DEMO_PASSWORD = "${lit}";`, demoEmail)).toHaveLength(1);
    expect(scanSpec(`const DEMO_PASSWORD = process.env.DEMO_PASSWORD;`, demoEmail)).toHaveLength(0);
    expect(scanSpec(`await page.getByLabel("Email").fill("${demoEmail}");\nawait page.getByLabel("Password", { exact: true }).fill("${lit}");`, demoEmail)).toHaveLength(1);
    expect(scanSpec(`await page.getByLabel("Email").fill("${demoEmail}");\nawait page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD!);`, demoEmail)).toHaveLength(0);
    expect(scanSpec(`await page.getByLabel("Email").fill("someone-else@example.test");\nawait page.getByLabel("Password", { exact: true }).fill("${lit}");`, demoEmail)).toHaveLength(0);
  });
});

describe("7. no workflow script mentions DEMO_PASSWORD", () => {
  it("not in any run: block of any workflow or action (so nothing can print it, and nothing sets it by hand)", () => {
    const offenders: string[] = [];
    for (const f of [...workflowFiles(), ...actionFiles()]) {
      if (baseName(f) in EXEMPT) continue;
      const d = parse(read(f)) as Workflow & { runs?: { steps?: Step[] } };
      const steps = [...Object.values(d.jobs ?? {}).flatMap((j) => j.steps ?? []), ...(d.runs?.steps ?? [])];
      steps.forEach((s, i) => {
        if (/DEMO_PASSWORD/.test(s.run ?? "")) offenders.push(`${baseName(f)} step ${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("wiring: which jobs seed, and which steps read the generated value from $GITHUB_ENV", () => {
  const ci = doc(".github/workflows/ci.yml");
  const jobs = ci.jobs ?? {};
  const seeds = (j: Job) => (j.steps ?? []).findIndex((s) => s.run === "npm run seed");

  it("exactly three jobs run `npm run seed`: checks, the e2e shards and the embed job (a fourth is a deliberate change: update this list and think about where its value goes)", () => {
    expect(Object.keys(jobs).filter((k) => seeds(jobs[k]) >= 0).sort()).toEqual(["checks", "e2e-embed-widget-on", "e2e-shard"]);
  });
  it("in each, the step that reads the value comes AFTER the seed step (a value exported to $GITHUB_ENV reaches only later steps)", () => {
    const readers: Record<string, RegExp> = {
      "e2e-shard": /test:e2e|playwright test/,
      "e2e-embed-widget-on": /test:e2e|playwright test/,
      checks: /vitest|npm test|npm run test/,
    };
    for (const [id, re] of Object.entries(readers)) {
      const steps = jobs[id].steps ?? [];
      const at = seeds(jobs[id]);
      const readerAt = steps.findIndex((s) => re.test(s.run ?? ""));
      expect(readerAt, `${id}: no step matching ${re}`).toBeGreaterThanOrEqual(0);
      expect(readerAt, `${id}: the reading step must follow the seed step`).toBeGreaterThan(at);
    }
  });
  it("each of those jobs starts its OWN local Supabase stack before it seeds, so the account exists only in that job's database", () => {
    for (const id of ["checks", "e2e-shard", "e2e-embed-widget-on"]) {
      const steps = jobs[id].steps ?? [];
      const stackAt = steps.findIndex((s) => s.uses === "./.github/actions/local-supabase");
      expect(stackAt, `${id}: no local stack step`).toBeGreaterThanOrEqual(0);
      expect(stackAt).toBeLessThan(seeds(jobs[id]));
    }
  });
  it("the seed steps do not define DEMO_PASSWORD themselves (it comes only from the fallback)", () => {
    for (const id of Object.keys(jobs)) for (const s of jobs[id].steps ?? []) expect("DEMO_PASSWORD" in (s.env ?? {})).toBe(false);
  });
});

describe("8. scripts/seed.ts: importing it seeds nothing; running it still works", () => {

  it("importing it did not start main(): no exit, no error output, and (the import itself) no throw", async () => {
    const { exitCalls, errCalls } = await loadSeed();
    expect(exitCalls).toBe(0);
    expect(errCalls).toBe(0);
  });

  it("run as a program with CI set, an empty password and no database: it masks first, exports the same value, then stops at the missing database, before any network", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "demo-pw-run-"));
    try {
      const file = path.join(dir, "github_env");
      writeFileSync(file, "");
      const r = spawnSync(path.join(ROOT, "node_modules/.bin/tsx"), ["scripts/seed.ts"], {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 90_000,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          CI: "true",
          GITHUB_ENV: file,
          DEMO_PASSWORD: "",
          NEXT_PUBLIC_SUPABASE_URL: "",
          SUPABASE_SERVICE_ROLE_KEY: "",
        } as unknown as NodeJS.ProcessEnv,
      });
      const exported = readFileSync(file, "utf8");
      const m = /^DEMO_PASSWORD=([0-9a-f]{48})\n$/.exec(exported);
      expect(m !== null, "the run must export DEMO_PASSWORD=<48 hex> to GITHUB_ENV").toBe(true);
      const outLines = (r.stdout ?? "").split("\n");
      const maskAt = outLines.findIndex((l) => l === `::add-mask::${m![1]}`);
      expect(maskAt, "the run must print the mask line for that same value").toBeGreaterThanOrEqual(0);
      // the value appears on exactly one line of anything the program printed
      const printed = `${r.stdout}\n${r.stderr}`.split("\n");
      expect(printed.filter((l) => l.includes(m![1])).length).toBe(1);
      expect(r.status).not.toBe(0);
      expect(/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set/.test(r.stderr ?? "")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("and with nothing set outside CI it refuses with the old message before doing anything", () => {
    const r = spawnSync(path.join(ROOT, "node_modules/.bin/tsx"), ["scripts/seed.ts"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 90_000,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DEMO_PASSWORD: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" } as unknown as NodeJS.ProcessEnv,
    });
    expect(r.status).not.toBe(0);
    expect(/DEMO_PASSWORD is not set\. Add it to \.env\.local/.test(r.stderr ?? "")).toBe(true);
  }, 120_000);
});

