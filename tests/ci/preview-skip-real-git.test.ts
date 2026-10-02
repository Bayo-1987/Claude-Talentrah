/**
 * The Ignored Build Step's fail-safe paths, against REAL git (not a fake): a temp "origin" with a main branch,
 * then PR branches shaped like the cases that must never skip a build.
 *
 *   rename src/ -> docs/     MUST build. `git diff --name-only` reports only the NEW path of a rename, so a
 *                            rename detector would see "docs/x.ts" and skip a build that deletes a source file.
 *   deleted src/ file        MUST build (the deletion is a change to what is served).
 *   no merge base            MUST build (unrelated history: nothing to compare against).
 *   shallow clone            deepened, then decided on the real diff.
 *   unreachable origin       MUST build.
 *   empty diff               MUST build.
 *
 * The fake-git unit tests (preview-skip.test.ts) prove the decision logic; this proves the git commands it issues
 * mean what the logic assumes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decide } from "../../scripts/vercel-ignore-build.mjs";

const SCRIPT = path.resolve(__dirname, "../../scripts/vercel-ignore-build.mjs");

const PREVIEW = { VERCEL_ENV: "preview" };

function run(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
const gitIn = (cwd: string) => (args: string[]) => run(cwd, args);

function write(dir: string, file: string, body = "x\n") {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), body);
}

let root: string;
let origin: string;

/** A fresh working clone of origin, on a new branch off main. */
function clone(name: string, extra: string[] = []): string {
  const dir = path.join(root, name);
  run(root, ["clone", "-q", ...extra, origin, dir]);
  run(dir, ["checkout", "-q", "-b", `pr-${name}`]);
  return dir;
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "ignore-build-"));
  origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  mkdirSync(seed);
  run(seed, ["init", "-q"]);
  write(seed, "src/app/page.tsx", "export default function P() { return null }\n");
  write(seed, "src/lib/util.ts", "export const a = 1;\n");
  write(seed, "docs/readme.md", "docs\n");
  write(seed, "tests/a.test.ts", "// t\n");
  run(seed, ["add", "-A"]);
  run(seed, ["commit", "-q", "-m", "base"]);
  // a few more commits so a depth-1 clone really is shallow
  for (let i = 0; i < 3; i++) {
    write(seed, `docs/n${i}.md`, `${i}\n`);
    run(seed, ["add", "-A"]);
    run(seed, ["commit", "-q", "-m", `c${i}`]);
  }
  run(root, ["clone", "-q", "--bare", seed, origin]);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("real git: what the Ignored Build Step decides", () => {
  it("a docs-only PR is skipped", () => {
    const dir = clone("docs-only");
    write(dir, "docs/new.md");
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-q", "-m", "docs"]);
    expect(decide({ env: PREVIEW, git: gitIn(dir) })).toMatchObject({ skip: true });
  });

  it("a tests-only PR is skipped", () => {
    const dir = clone("tests-only");
    write(dir, "tests/b.test.ts");
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-q", "-m", "tests"]);
    expect(decide({ env: PREVIEW, git: gitIn(dir) })).toMatchObject({ skip: true });
  });

  it("a RENAME from src/ into docs/ builds (the rename's old path is a deleted source file)", () => {
    const dir = clone("rename");
    mkdirSync(path.join(dir, "docs"), { recursive: true });
    run(dir, ["mv", "src/lib/util.ts", "docs/util.ts"]);
    run(dir, ["commit", "-q", "-am", "move a source file into docs"]);
    // sanity: plain `git diff --name-only` WOULD hide the src/ path, which is the trap this guards
    const plain = run(dir, ["diff", "--name-only", "origin/main", "HEAD"]).trim().split("\n");
    expect(plain.some((f) => f.startsWith("src/")), "git's own rename detection hides the src/ path").toBe(false);
    expect(decide({ env: PREVIEW, git: gitIn(dir) })).toMatchObject({ skip: false });
  });

  it("a DELETED src/ file builds", () => {
    const dir = clone("deleted");
    run(dir, ["rm", "-q", "src/lib/util.ts"]);
    run(dir, ["commit", "-q", "-m", "delete a source file"]);
    expect(decide({ env: PREVIEW, git: gitIn(dir) })).toMatchObject({ skip: false });
  });

  it("an edit to src/ alongside docs builds", () => {
    const dir = clone("mixed");
    write(dir, "docs/new.md");
    write(dir, "src/app/page.tsx", "export default function P() { return 1 }\n");
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-q", "-m", "mixed"]);
    expect(decide({ env: PREVIEW, git: gitIn(dir) })).toMatchObject({ skip: false });
  });

  it("a docs-only LAST commit on top of an earlier src change still builds (the diff is the whole PR)", () => {
    const dir = clone("whole-pr");
    write(dir, "src/app/page.tsx", "export default function P() { return 2 }\n");
    run(dir, ["commit", "-q", "-am", "src change"]);
    write(dir, "docs/late.md");
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-q", "-m", "docs on top"]);
    expect(decide({ env: PREVIEW, git: gitIn(dir) })).toMatchObject({ skip: false });
  });

  it("a SHALLOW clone (depth 1) is deepened and decided on the real diff", () => {
    const dir = path.join(root, "shallow");
    run(root, ["clone", "-q", "--depth=1", `file://${origin}`, dir]);
    run(dir, ["checkout", "-q", "-b", "pr-shallow"]);
    expect(run(dir, ["rev-parse", "--is-shallow-repository"]).trim()).toBe("true");
    write(dir, "docs/shallow.md");
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-q", "-m", "docs"]);
    expect(decide({ env: PREVIEW, git: gitIn(dir) })).toMatchObject({ skip: true });
  });

  it("no merge base (unrelated history) builds", () => {
    const dir = clone("orphan");
    run(dir, ["checkout", "-q", "--orphan", "unrelated"]);
    run(dir, ["rm", "-rfq", "."]);
    write(dir, "docs/only.md");
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-q", "-m", "unrelated docs"]);
    expect(decide({ env: PREVIEW, git: gitIn(dir) })).toMatchObject({ skip: false });
  });

  it("an unreachable origin (fetch fails) builds", () => {
    const dir = clone("no-origin");
    write(dir, "docs/new.md");
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-q", "-m", "docs"]);
    run(dir, ["remote", "set-url", "origin", path.join(root, "does-not-exist.git")]);
    expect(decide({ env: PREVIEW, git: gitIn(dir) })).toMatchObject({ skip: false });
  });

  it("an empty diff (branch == main) builds", () => {
    const dir = clone("empty");
    expect(decide({ env: PREVIEW, git: gitIn(dir) })).toMatchObject({ skip: false });
  });
});

describe("production is NEVER skipped, whatever the diff", () => {
  /** A docs-only PR: the exact change that WOULD skip a preview. */
  function docsOnlyClone(name: string): string {
    const dir = clone(name);
    write(dir, "docs/only.md");
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-q", "-m", "docs"]);
    return dir;
  }

  it("the same docs-only change: skipped as a preview, built as production (decide, real git)", () => {
    const dir = docsOnlyClone("prod-decide");
    expect(decide({ env: { VERCEL_ENV: "preview" }, git: gitIn(dir) })).toMatchObject({ skip: true });
    expect(decide({ env: { VERCEL_ENV: "production" }, git: gitIn(dir) })).toMatchObject({ skip: false });
  });

  it("the script as a real process: exit 0 (skip) for a preview, exit 1 (build) for production, and for anything else", () => {
    const dir = docsOnlyClone("prod-process");
    const exit = (env: Record<string, string | undefined>) => {
      const r = spawnSync("node", [SCRIPT], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, VERCEL_ENV: undefined, ...env },
      });
      return { code: r.status, out: r.stdout };
    };
    const preview = exit({ VERCEL_ENV: "preview" });
    expect(preview.code, preview.out).toBe(0);
    expect(preview.out).toMatch(/SKIP/);
    for (const env of [{ VERCEL_ENV: "production" }, { VERCEL_ENV: "development" }, {}]) {
      const r = exit(env);
      expect(r.code, `${JSON.stringify(env)}: ${r.out}`).toBe(1);
      expect(r.out).toMatch(/BUILD/);
    }
  });
});
