/**
 * The Ignored Build Step under VERCEL'S REAL CONDITIONS, run as a real process.
 *
 * What went wrong in production (the build log of #645's docs-only preview, deployment dpl_H9PgCfq…):
 *
 *   Cloning github.com/Bayo-1987/Claude-Talentrah (Branch: docs/handoff-record-620-623-640, Commit: 05bb7c5)
 *   Cloning completed: 2.083s
 *   Running "node scripts/vercel-ignore-build.mjs"
 *   [ignore-build] BUILD: could not diff against main (Command failed: git fetch --no-tags origin +main:refs/remotes/origin/main): build
 *
 * Vercel's checkout is a SHALLOW, SINGLE-BRANCH clone with no usable `origin` remote, so the script's fetch of
 * main from `origin` failed on every build and every preview built. The fail-safe worked (it built); the feature
 * never did. The first version of the script was tested against clones that HAD an origin, which is the one
 * thing Vercel's does not.
 *
 * This file reproduces Vercel's checkout (`git clone --depth=10 --single-branch --branch <pr>` then the origin
 * remote removed) and fetches main by URL, built from VERCEL_GIT_REPO_OWNER / VERCEL_GIT_REPO_SLUG. The URL is
 * the "github.com" base by default; IGNORE_BUILD_GIT_BASE_URL points it at a local directory standing in for
 * GitHub here, and is not set on Vercel.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(__dirname, "../../scripts/vercel-ignore-build.mjs");
const OWNER = "Bayo-1987";
const SLUG = "Claude-Talentrah";

let root: string;
let github: string; // stands in for https://github.com
let upstream: string; // github/<owner>/<slug>.git
let seed: string;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function write(dir: string, file: string, body = "x\n") {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), body);
}
function commit(file: string, msg: string, body?: string) {
  write(seed, file, body);
  git(seed, ["add", "-A"]);
  git(seed, ["commit", "-q", "-m", msg]);
}

/** Vercel's checkout: shallow, single branch, and NO origin remote. */
let cloneCount = 0;
function vercelClone(branch: string, depth = 10): string {
  const dir = path.join(root, `vc${++cloneCount}-${branch.replace(/\W/g, "-")}-${depth}`);
  git(root, ["clone", "-q", `--depth=${depth}`, "--single-branch", "--branch", branch, `file://${upstream}`, dir]);
  git(dir, ["remote", "remove", "origin"]);
  expect(git(dir, ["remote"]).trim(), "the Vercel-like clone must have no remote").toBe("");
  expect(git(dir, ["rev-parse", "--is-shallow-repository"]).trim()).toBe("true");
  return dir;
}

function run(cwd: string, branch: string, env: Record<string, string | undefined> = {}) {
  const r = spawnSync("node", [SCRIPT], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      VERCEL_ENV: "preview",
      VERCEL_GIT_REPO_OWNER: OWNER,
      VERCEL_GIT_REPO_SLUG: SLUG,
      VERCEL_GIT_COMMIT_REF: branch,
      IGNORE_BUILD_GIT_BASE_URL: `file://${github}`,
      ...env,
    },
    timeout: 60_000,
  });
  const line = (r.stdout.match(/\[ignore-build\] (?:SKIP|BUILD):.*/g) ?? []).at(-1) ?? "";
  return { code: r.status, out: r.stdout, line };
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "vercel-like-"));
  github = path.join(root, "github");
  upstream = path.join(github, OWNER, `${SLUG}.git`);
  seed = path.join(root, "seed");
  mkdirSync(seed);
  git(seed, ["init", "-q"]);
  commit("src/app/page.tsx", "base src");
  commit("docs/readme.md", "base docs");
  commit("tests/a.test.ts", "base tests");
  // main is longer than the clone depth, so a depth-10 checkout is genuinely shallow, as Vercel's is
  for (let i = 0; i < 14; i++) commit(`docs/m${i}.md`, `main ${i}`);

  // PR: docs only, short
  git(seed, ["checkout", "-q", "-b", "pr-docs"]);
  commit("docs/new.md", "docs");
  // PR: docs + src
  git(seed, ["checkout", "-q", "main"]);
  git(seed, ["checkout", "-q", "-b", "pr-mixed"]);
  commit("docs/new.md", "docs");
  commit("src/app/page.tsx", "src change", "export default function P() { return 1 }\n");
  // PR: LONG, docs only: 15 commits, fork point is beyond a depth-10 clone
  git(seed, ["checkout", "-q", "main"]);
  git(seed, ["checkout", "-q", "-b", "pr-long-docs"]);
  for (let i = 0; i < 15; i++) commit(`docs/long${i}.md`, `long ${i}`);
  // PR: LONG, whose OLDEST commit changes src (outside a depth-10 window), then 14 docs commits
  git(seed, ["checkout", "-q", "main"]);
  git(seed, ["checkout", "-q", "-b", "pr-long-src-first"]);
  commit("src/lib/hidden.ts", "src change, older than the clone depth", "export const h = 1;\n");
  for (let i = 0; i < 14; i++) commit(`docs/ls${i}.md`, `ls ${i}`);
  // main moves on after the forks
  git(seed, ["checkout", "-q", "main"]);
  commit("docs/main-later.md", "main moved on");

  mkdirSync(path.dirname(upstream), { recursive: true });
  git(root, ["clone", "-q", "--bare", seed, upstream]);
});

afterAll(() => {
  try {
    chmodSync(github, 0o755);
  } catch {
    // may already be gone
  }
  rmSync(root, { recursive: true, force: true });
});

describe("Vercel's checkout (shallow, single-branch, no origin)", () => {
  it("a docs-only PR is SKIPPED", () => {
    const dir = vercelClone("pr-docs");
    const r = run(dir, "pr-docs");
    expect(r.line).toMatch(/\[ignore-build\] SKIP:/);
    expect(r.code).toBe(0);
  });

  it("docs plus a src change BUILDS", () => {
    const dir = vercelClone("pr-mixed");
    const r = run(dir, "pr-mixed");
    expect(r.line).toMatch(/\[ignore-build\] BUILD: src\/app\/page\.tsx is not docs\/tests\/e2e/);
    expect(r.code).toBe(1);
  });

  it("a PR LONGER than the clone depth is deepened until the merge-base is found, then decided on the real diff: docs-only SKIPS", () => {
    const dir = vercelClone("pr-long-docs", 10);
    const r = run(dir, "pr-long-docs");
    expect(r.line, r.out).toMatch(/\[ignore-build\] SKIP:/);
  });

  it("...and a src change OLDER than the clone depth is still seen, so it BUILDS (the case a depth-10 diff would miss)", () => {
    const dir = vercelClone("pr-long-src-first", 10);
    const r = run(dir, "pr-long-src-first");
    expect(r.line, r.out).toMatch(/\[ignore-build\] BUILD: src\/lib\/hidden\.ts/);
  });

  it("main having moved on since the fork does not matter", () => {
    const dir = vercelClone("pr-docs");
    expect(run(dir, "pr-docs").line).toMatch(/SKIP/);
  });
});

describe("it always builds when it cannot be sure", () => {
  it("production ALWAYS builds, in the very same docs-only checkout", () => {
    const dir = vercelClone("pr-docs");
    expect(run(dir, "pr-docs", { VERCEL_ENV: "preview" }).line).toMatch(/SKIP/);
    for (const env of ["production", "development", ""]) {
      const r = run(dir, "pr-docs", { VERCEL_ENV: env });
      expect(r.line, `VERCEL_ENV=${env}`).toMatch(/\[ignore-build\] BUILD:/);
      expect(r.code).toBe(1);
    }
  });

  it("the network is off / GitHub is unreachable: BUILDS", () => {
    const dir = vercelClone("pr-docs");
    const r = run(dir, "pr-docs", { IGNORE_BUILD_GIT_BASE_URL: `file://${path.join(root, "nowhere")}` });
    expect(r.line).toMatch(/\[ignore-build\] BUILD: could not diff against main/);
    expect(r.code).toBe(1);
  });

  it("the repo goes PRIVATE later (the fetch is refused): BUILDS", () => {
    const dir = vercelClone("pr-docs");
    chmodSync(github, 0o000); // unreadable, as a private repo is to an anonymous fetch
    try {
      const r = run(dir, "pr-docs");
      expect(r.line).toMatch(/\[ignore-build\] BUILD:/);
      expect(r.code).toBe(1);
    } finally {
      chmodSync(github, 0o755);
    }
  });

  it.each([
    [{ VERCEL_GIT_REPO_OWNER: undefined }, /VERCEL_GIT_REPO_OWNER/],
    [{ VERCEL_GIT_REPO_SLUG: undefined }, /VERCEL_GIT_REPO_SLUG/],
    [{ VERCEL_GIT_REPO_OWNER: "", VERCEL_GIT_REPO_SLUG: "" }, /VERCEL_GIT_REPO_OWNER.*VERCEL_GIT_REPO_SLUG/],
  ])("Vercel's repo env is MISSING (%j): BUILDS, and says which variable", (env, named) => {
    const dir = vercelClone("pr-docs");
    const r = run(dir, "pr-docs", env);
    expect(r.line).toMatch(/\[ignore-build\] BUILD:/);
    expect(r.line).toMatch(named);
    expect(r.code).toBe(1);
  });

  it("no branch name to deepen with (VERCEL_GIT_COMMIT_REF missing) on a long PR: BUILDS rather than guessing", () => {
    const dir = vercelClone("pr-long-docs", 10);
    const r = run(dir, "pr-long-docs", { VERCEL_GIT_COMMIT_REF: undefined });
    expect(r.line).toMatch(/\[ignore-build\] BUILD:/);
  });

  it("an owner or slug that is not a plain name (URL injection) BUILDS", () => {
    const dir = vercelClone("pr-docs");
    for (const bad of ["../evil", "a/b", "x y", "a;b"]) {
      expect(run(dir, "pr-docs", { VERCEL_GIT_REPO_OWNER: bad }).line, bad).toMatch(/BUILD:/);
    }
  });
});

describe("the repo is named by Vercel's env, never hard-coded", () => {
  it("a different owner/slug fetches from THAT repo (and so builds here, where it does not exist)", () => {
    const dir = vercelClone("pr-docs");
    const r = run(dir, "pr-docs", { VERCEL_GIT_REPO_OWNER: "someone-else", VERCEL_GIT_REPO_SLUG: "other-repo" });
    expect(r.line).toMatch(/BUILD: could not diff against main/);
  });

  it("the script's source names no owner or slug", () => {
    const src = execFileSync("cat", [SCRIPT], { encoding: "utf8" }).replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
    expect(src).not.toMatch(/Bayo-1987|Claude-Talentrah/);
  });
});
