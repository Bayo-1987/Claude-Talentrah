/**
 * A Lighthouse run that sends the Vercel Deployment Protection bypass header must never upload its reports to a public place.
 *
 * WHY. The PR-preview job (lighthouse-budget.yml) passes the bypass header with `--collect.settings.extraHeaders`. Lighthouse records the settings it ran with inside every report
 * (configSettings.extraHeaders), and the config it used uploaded the reports to `temporary-public-storage`, a public location. The value was sitting, unmasked, in four public reports of one PR. Masking it in
 * the log did nothing for the stored report. The fix is the upload target, not the workflow: a header-carrying run uploads only to the runner's own disk (`filesystem`), which dies with the runner.
 *
 * WHAT IS CHECKED, BY COMMAND AND NEVER BY STEP NAME. Every step in every workflow whose command runs Lighthouse CI (`lhci`, `@lhci/cli`, a `lighthouse` command, or a lighthouse action) AND passes an
 * extraHeaders option or a protection-bypass header (in the command, its `with:` inputs or the names of its `env:` variables) must use a config whose upload target is explicitly `filesystem` with an
 * output directory, and must not override the target on its command line. The config a step uses is the one it names with `--config` (or `with.configPath`), else the default `.lighthouserc.json`.
 *
 * WHAT lhci DOES WITH THE CHOICES (read in @lhci/cli 0.15.1, the pinned version, src/autorun/autorun.js and src/upload/upload.js): `autorun` runs the upload step ONLY when an `upload` section exists
 * (autorun.js: "We'll run upload only if they've configured the upload command"), so no `upload` block means no upload at all; but an `upload` section WITHOUT a target defaults to the `lhci` server target
 * (upload.js: target default 'lhci'), and command-line `--upload.*` flags are merged over the config. A default is a property of a tool version and not something a reader can see, so this test requires the target
 * to be written out as `filesystem`, and treats a missing block, a missing target, any other target and a command-line override as unsafe.
 *
 * THE SAME RUN MUST NOT PUBLISH THE FILES FROM THE DISK EITHER. The reports are written to `.lighthouseci/` (and to the config's `outputDir`) on the runner. A later step in the same job that uploads
 * that directory as an artifact (or by any upload command) would put the header back into a downloadable file, so no step in a job that carries the header may upload it.
 *
 * The real behaviour (no public report URL printed by the job) can only be seen in the PR's own Lighthouse run; this file pins the configuration that makes it so.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "yaml";

type Step = { name?: string; run?: string; uses?: string; with?: Record<string, unknown>; env?: Record<string, unknown> };

const LHCI_COMMAND = /@lhci\/cli|\blhci\b|lighthouse-ci|(^|[\s;&|])lighthouse(\s|$)/m;
const HEADER_OPTION = /extra-?headers|protection-bypass|bypass[_-]?secret/i;
const DEFAULT_CONFIG = ".lighthouserc.json";

/** The text a step's command and inputs are made of: what it runs, what it is given, and the NAMES (never values) of its environment variables. */
function stepText(step: Step): string {
  return [step.run ?? "", step.uses ?? "", JSON.stringify(step.with ?? {}), Object.keys(step.env ?? {}).join(" ")].join("\n");
}

function configPathOf(step: Step): string {
  const fromRun = /--config(?:=|\s+)["']?([^\s"']+)/.exec(step.run ?? "");
  if (fromRun) return fromRun[1];
  const fromWith = step.with?.configPath;
  return typeof fromWith === "string" ? fromWith : DEFAULT_CONFIG;
}

/** Every upload target the command line itself names: `--upload.target=x`, `--upload.target x`, `lhci upload --target=x`. */
function commandLineTargets(run: string): string[] {
  const out = [...run.matchAll(/--upload\.target(?:=|\s+)["']?([^\s"']+)/g)].map((m) => m[1]);
  for (const m of run.matchAll(/\blhci\s+upload\b[^\n]*?--target(?:=|\s+)["']?([^\s"']+)/g)) out.push(m[1]);
  return out;
}

/** The problems, one line each, with no header value anywhere in them. `examined` is how many header-carrying Lighthouse steps were found, so a search that finds nothing cannot pass for a clean one. */
function headerRunsUploadingPublicly(root: string): { examined: number; problems: string[] } {
  const dir = join(root, ".github/workflows");
  const problems: string[] = [];
  let examined = 0;
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const doc = parse(readFileSync(join(dir, file), "utf8")) as { jobs?: Record<string, { steps?: Step[] }> } | null;
    for (const [jobId, job] of Object.entries(doc?.jobs ?? {})) {
      (job.steps ?? []).forEach((step, index) => {
        const text = stepText(step);
        if (!LHCI_COMMAND.test(text) || !HEADER_OPTION.test(text)) return;
        examined++;
        const where = `${file} job ${jobId} step ${index + 1}`;
        for (const target of commandLineTargets(step.run ?? "")) {
          if (target !== "filesystem") problems.push(`${where}: the command line sets the upload target to "${target}"`);
        }
        const configPath = configPathOf(step);
        const full = join(root, configPath);
        if (!configPath.endsWith(".json")) {
          problems.push(`${where}: its config ${configPath} is not JSON, so its upload target cannot be checked`);
          return;
        }
        if (!existsSync(full)) {
          problems.push(`${where}: its config ${configPath} does not exist`);
          return;
        }
        const upload = (JSON.parse(readFileSync(full, "utf8")) as { ci?: { upload?: { target?: unknown; outputDir?: unknown } } }).ci?.upload;
        if (!upload) problems.push(`${where}: ${configPath} has no upload block (the target must be written out as filesystem)`);
        else if (upload.target !== "filesystem") problems.push(`${where}: ${configPath} upload target is ${upload.target === undefined ? "not set" : `"${String(upload.target)}"`}, not filesystem`);
        else if (typeof upload.outputDir !== "string" || upload.outputDir.trim() === "") problems.push(`${where}: ${configPath} has the filesystem target but no outputDir`);
      });
    }
  }
  return { examined, problems };
}

const UPLOAD_ACTION = /upload-artifact|upload-pages-artifact|actions\/cache\/save|actions\/cache@/i;
const UPLOAD_COMMAND = /\b(upload|publish|s3\s+(cp|sync)|gsutil|rclone|scp)\b|curl[^\n]*(\s-T\b|\s--upload-file|\s-F\b)/i;

/** True when an upload `path:` entry (a line of an artifact step's path list) would take something from `dir`: the directory itself, a part of it, a parent of it, or a catch-all. */
function pathReaches(entry: string, dir: string): boolean {
  const e = entry.trim().replace(/^\.\//, "").replace(/\/+$/, "").replace(/\/\*{1,2}$/, "");
  const d = dir.replace(/^\.\//, "").replace(/\/+$/, "");
  if (e === "" || e === "." || e === "*" || e === "**") return true;
  return d === e || d.startsWith(`${e}/`) || e.startsWith(`${d}/`);
}

/** Steps, in the jobs that carry the header, that publish the directories the reports are written to. */
function headerJobsPublishingReportFiles(root: string): { jobs: number; problems: string[] } {
  const dir = join(root, ".github/workflows");
  const problems: string[] = [];
  let jobs = 0;
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const doc = parse(readFileSync(join(dir, file), "utf8")) as { jobs?: Record<string, { steps?: Step[] }> } | null;
    for (const [jobId, job] of Object.entries(doc?.jobs ?? {})) {
      const steps = job.steps ?? [];
      const carrying = steps.filter((st) => LHCI_COMMAND.test(stepText(st)) && HEADER_OPTION.test(stepText(st)));
      if (carrying.length === 0) continue;
      jobs++;
      const dirs = new Set<string>([".lighthouseci"]);
      for (const st of carrying) {
        const configPath = configPathOf(st);
        if (configPath.endsWith(".json") && existsSync(join(root, configPath))) {
          const out = (JSON.parse(readFileSync(join(root, configPath), "utf8")) as { ci?: { upload?: { outputDir?: unknown } } }).ci?.upload?.outputDir;
          if (typeof out === "string" && out.trim() !== "") dirs.add(out);
        }
      }
      steps.forEach((st, index) => {
        const where = `${file} job ${jobId} step ${index + 1}`;
        if (UPLOAD_ACTION.test(st.uses ?? "")) {
          const entries = String(st.with?.path ?? "").split(/\r?\n/).filter((l) => l.trim() !== "");
          for (const d of dirs) if (entries.some((e) => pathReaches(e, d))) problems.push(`${where}: uploads "${d}" (or a parent or part of it) as an artifact`);
        }
        const run = st.run ?? "";
        if (UPLOAD_COMMAND.test(run) && [...dirs].some((d) => run.includes(d))) problems.push(`${where}: a command that uploads names the report directory`);
      });
    }
  }
  return { jobs, problems };
}

describe("every Lighthouse run that carries the bypass header uploads only to the runner's disk (the real repo)", () => {
  it("finds the preview job's step, and every header-carrying Lighthouse step has a filesystem upload target", () => {
    const { examined, problems } = headerRunsUploadingPublicly(process.cwd());
    expect(examined, "no header-carrying Lighthouse step was found: the search would pass on anything").toBeGreaterThanOrEqual(1);
    expect(problems).toEqual([]);
  });

  it("no step in a job that carries the header uploads the report directories as an artifact or by an upload command", () => {
    const { jobs, problems } = headerJobsPublishingReportFiles(process.cwd());
    expect(jobs, "no job carrying the header was found: the search would pass on anything").toBeGreaterThanOrEqual(1);
    expect(problems).toEqual([]);
  });

  it("production's upload target is unchanged: the scheduled production run carries no header and keeps its public report link", () => {
    const production = JSON.parse(readFileSync(join(process.cwd(), ".lighthouserc.json"), "utf8")) as { ci: { upload: { target: string } } };
    expect(production.ci.upload.target).toBe("temporary-public-storage");
  });

  it("the preview config still holds the three category budgets (this change only touches the upload block)", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), ".lighthouserc.preview.json"), "utf8")) as { ci: { assert: { assertions: Record<string, unknown> } } };
    expect(Object.keys(config.ci.assert.assertions).sort()).toEqual(["categories:accessibility", "categories:best-practices", "categories:performance"]);
  });
});

describe("the check itself, on workflows made for the purpose", () => {
  const roots: string[] = [];
  afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  /** A throwaway repo root: workflow files (name -> YAML text) and config files (path -> JSON object). */
  function repo(workflows: Record<string, string>, configs: Record<string, unknown>): string {
    const root = mkdtempSync(join(tmpdir(), "lhci-header-"));
    roots.push(root);
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    for (const [name, text] of Object.entries(workflows)) writeFileSync(join(root, ".github/workflows", name), text);
    for (const [path, value] of Object.entries(configs)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), JSON.stringify(value));
    }
    return root;
  }
  const step = (name: string, run: string, env = "") => `name: w\non: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - name: ${name}\n${env}        run: |\n${run.split("\n").map((l) => `          ${l}`).join("\n")}\n`;
  const SAFE = { ci: { upload: { target: "filesystem", outputDir: ".lighthouseci/reports" } } };
  const PUBLIC = { ci: { upload: { target: "temporary-public-storage" } } };
  const WITH_HEADER = (cfg: string) => `npx --yes @lhci/cli@0.15.1 autorun --config=${cfg} \\\n  --collect.settings.extraHeaders=MASKED`;

  it("a header-carrying step with a filesystem config is clean and is counted", () => {
    const root = repo({ "a.yml": step("Run it", WITH_HEADER(".lighthouserc.preview.json")) }, { ".lighthouserc.preview.json": SAFE });
    expect(headerRunsUploadingPublicly(root)).toEqual({ examined: 1, problems: [] });
  });

  it("a header-carrying step whose config uploads to temporary-public-storage is a problem", () => {
    const root = repo({ "a.yml": step("Run it", WITH_HEADER(".lighthouserc.preview.json")) }, { ".lighthouserc.preview.json": PUBLIC });
    const r = headerRunsUploadingPublicly(root);
    expect(r.examined).toBe(1);
    expect(r.problems.join("\n")).toContain('upload target is "temporary-public-storage", not filesystem');
  });

  it("is found by its command, not its name: a step renamed to anything is still examined", () => {
    for (const name of ["Run Lighthouse CI against the 4 key pages", "Check pages", "x", "Deploy"]) {
      const root = repo({ "a.yml": step(name, WITH_HEADER(".lighthouserc.preview.json")) }, { ".lighthouserc.preview.json": PUBLIC });
      expect(headerRunsUploadingPublicly(root).problems, `step named "${name}"`).toHaveLength(1);
    }
  });

  it("a new step in ANOTHER workflow file, using ANOTHER config, is read too (not one hard-coded file)", () => {
    const root = repo(
      { "a.yml": step("One", WITH_HEADER(".lighthouserc.preview.json")), "b.yml": step("Two", WITH_HEADER("configs/other.json")) },
      { ".lighthouserc.preview.json": SAFE, "configs/other.json": PUBLIC },
    );
    const r = headerRunsUploadingPublicly(root);
    expect(r.examined).toBe(2);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain("b.yml");
    expect(r.problems[0]).toContain("configs/other.json");
  });

  it("with no --config the default .lighthouserc.json is the config that is read", () => {
    const run = "npx --yes @lhci/cli@0.15.1 autorun \\\n  --collect.settings.extraHeaders=MASKED";
    expect(headerRunsUploadingPublicly(repo({ "a.yml": step("Run", run) }, { ".lighthouserc.json": PUBLIC })).problems).toHaveLength(1);
    expect(headerRunsUploadingPublicly(repo({ "a.yml": step("Run", run) }, { ".lighthouserc.json": SAFE })).problems).toEqual([]);
  });

  it("an upload block with no target, no upload block at all, a missing outputDir, a non-JSON config and a missing config are all unsafe (a default is not a promise)", () => {
    const cases: Array<[string, unknown, string]> = [
      ["no target", { ci: { upload: {} } }, "not set"],
      ["no upload block", { ci: { collect: { numberOfRuns: 3 } } }, "no upload block"],
      ["filesystem without outputDir", { ci: { upload: { target: "filesystem" } } }, "no outputDir"],
    ];
    for (const [label, cfg, expected] of cases) {
      const root = repo({ "a.yml": step("Run", WITH_HEADER(".lighthouserc.preview.json")) }, { ".lighthouserc.preview.json": cfg });
      expect(headerRunsUploadingPublicly(root).problems.join("\n"), label).toContain(expected);
    }
    expect(headerRunsUploadingPublicly(repo({ "a.yml": step("Run", WITH_HEADER(".lighthouserc.js")) }, {})).problems.join("\n")).toContain("not JSON");
    expect(headerRunsUploadingPublicly(repo({ "a.yml": step("Run", WITH_HEADER("nope.json")) }, {})).problems.join("\n")).toContain("does not exist");
  });

  it("a command-line --upload.target other than filesystem is a problem even when the config is safe", () => {
    for (const flag of ["--upload.target=temporary-public-storage", "--upload.target temporary-public-storage", '--upload.target="lhci"']) {
      const root = repo({ "a.yml": step("Run", `${WITH_HEADER(".lighthouserc.preview.json")} \\\n  ${flag}`) }, { ".lighthouserc.preview.json": SAFE });
      expect(headerRunsUploadingPublicly(root).problems.join("\n"), flag).toContain("the command line sets the upload target");
    }
  });

  it("a header passed only by environment variable NAME (no flag text) still marks the step, and a Lighthouse step with no header is not examined", () => {
    const env = "        env:\n          VERCEL_AUTOMATION_BYPASS_SECRET: MASKED\n";
    const root = repo({ "a.yml": step("Run", "npx --yes @lhci/cli@0.15.1 autorun --config=.lighthouserc.preview.json", env) }, { ".lighthouserc.preview.json": PUBLIC });
    expect(headerRunsUploadingPublicly(root).problems).toHaveLength(1);
    const plain = repo({ "a.yml": step("Run", "npx --yes @lhci/cli@0.15.1 autorun --config=.lighthouserc.json") }, { ".lighthouserc.json": PUBLIC });
    expect(headerRunsUploadingPublicly(plain)).toEqual({ examined: 0, problems: [] });
  });

  it("a lighthouse ACTION with a header input is examined through its with: inputs", () => {
    const wf = `name: w\non: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: treosh/lighthouse-ci-action@v12\n        with:\n          configPath: .lighthouserc.preview.json\n          extraHeaders: MASKED\n`;
    const root = repo({ "a.yml": wf }, { ".lighthouserc.preview.json": PUBLIC });
    expect(headerRunsUploadingPublicly(root).problems.join("\n")).toContain("upload target is");
  });

  it("an artifact upload of the report directory, of its outputDir, of a part, a parent or everything, is a problem; other artifacts and other jobs are not", () => {
    const job = (extra: string) => `name: w\non: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Run\n        run: |\n          ${WITH_HEADER(".lighthouserc.preview.json").split("\n").join("\n          ")}\n${extra}`;
    const art = (path: string) => `      - uses: actions/upload-artifact@v7\n        with:\n          name: x\n          path: ${path.startsWith("|") ? path : `'${path}'`}\n`;
    const cfg = { ".lighthouserc.preview.json": { ci: { upload: { target: "filesystem", outputDir: "out/lh" } } } };
    const problemsFor = (extra: string) => headerJobsPublishingReportFiles(repo({ "a.yml": job(extra) }, cfg)).problems;
    for (const path of [".lighthouseci", ".lighthouseci/", "./.lighthouseci/reports", ".lighthouseci/reports/*.json", "out/lh", "out/lh/**", "out"]) {
      expect(problemsFor(art(path)), `path ${path}`).toHaveLength(1);
    }
    // A catch-all reaches both directories the job writes reports to (.lighthouseci and the configured outputDir), so it is reported once for each.
    for (const path of [".", "**", "./", "*"]) expect(problemsFor(art(path)), `path ${path}`).toHaveLength(2);
    expect(problemsFor(art("|\n            playwright-report/\n            .lighthouseci/")), "a path list").toHaveLength(1);
    for (const path of ["playwright-report/", "test-results/", "blob-report/"]) expect(problemsFor(art(path)), `path ${path}`).toEqual([]);
    expect(headerJobsPublishingReportFiles(repo({ "a.yml": job(""), "b.yml": job("").replace("jobs:\n  j:", "jobs:\n  k:") + art(".lighthouseci") }, cfg)).problems).toHaveLength(1);
    const otherJob = `name: w\non: push\njobs:\n  other:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/upload-artifact@v7\n        with:\n          path: .lighthouseci\n`;
    expect(headerJobsPublishingReportFiles(repo({ "a.yml": job(""), "c.yml": otherJob }, cfg)).problems, "a job that does not carry the header is not this test's business").toEqual([]);
  });

  it("an upload COMMAND that names the report directory is a problem, and a job with no header is not examined at all", () => {
    const cfg = { ".lighthouserc.preview.json": SAFE };
    const withCmd = (cmd: string) => `name: w\non: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Run\n        run: |\n          ${WITH_HEADER(".lighthouserc.preview.json").split("\n").join("\n          ")}\n      - name: Send\n        run: |\n          ${cmd}\n`;
    for (const cmd of ["gh release upload v1 .lighthouseci/reports/lhr.json", "aws s3 cp .lighthouseci s3://bucket --recursive", "curl -T .lighthouseci/reports/lhr.json https://example.invalid/"]) {
      expect(headerJobsPublishingReportFiles(repo({ "a.yml": withCmd(cmd) }, cfg)).problems, cmd).toHaveLength(1);
    }
    expect(headerJobsPublishingReportFiles(repo({ "a.yml": withCmd("ls .lighthouseci") }, cfg)).problems).toEqual([]);
    expect(headerJobsPublishingReportFiles(repo({ "a.yml": step("Run", "echo hi") }, {}))).toEqual({ jobs: 0, problems: [] });
  });
});
