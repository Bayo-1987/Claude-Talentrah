/**
 * The Vercel "Ignored Build Step" (scripts/vercel-ignore-build.mjs, wired in vercel.json) skips a PREVIEW build
 * only when every file the PR changes is docs, tests or e2e. This pins the classifier, the decision around it,
 * and that the Lighthouse workflow's `paths-ignore` is the SAME list: Lighthouse waits for the PR's own preview,
 * so a skipped preview with a still-running Lighthouse would be a check that hangs and then fails.
 *
 * Why the rule is this narrow. A preview is what Lighthouse measures and what a reviewer clicks. Skipping is safe
 * only for files that cannot change what is served: docs, and files that never ship (tests/, e2e/). `next build`
 * does type-check tests/ and e2e/ (tsconfig includes **\/*.ts), so a test-only type error would no longer fail the
 * preview build; the required "Typecheck, lint, unit tests" job still catches it, and that is the check that gates
 * the merge.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SKIP_PATHS, decide, isSafeToSkip, shouldSkipPreview } from "../../scripts/vercel-ignore-build.mjs";

const ROOT = path.resolve(__dirname, "../..");

describe("isSafeToSkip — what may be skipped", () => {
  it.each([
    "docs/auto-apply.md",
    "docs/images/diagram.png",
    "tests/format/datetime.test.ts",
    "tests/support/auth.ts",
    "e2e/jd-demo.spec.ts",
    "e2e/fixtures/authed.ts",
    "handoff-status.md",
    "CLAUDE.md",
    "README.md",
  ])("%s is safe to skip", (file) => {
    expect(isSafeToSkip(file)).toBe(true);
  });

  it.each([
    "src/app/page.tsx",
    "src/components/marketing/hero-section.tsx",
    "src/fonts/README.md", // markdown, but under src/: not skipped
    "public/robots.txt",
    "supabase/migrations/0204_anonymous_demo_attempts.sql",
    "supabase/migrations/README.md", // markdown outside docs/: conservative
    "scripts/vercel-ignore-build.mjs",
    "package.json",
    "package-lock.json",
    "next.config.ts",
    "vercel.json",
    "tsconfig.json",
    ".github/workflows/ci.yml",
    ".github/workflows/lighthouse-budget.yml",
    "middleware.ts",
    "docs-extra/app.ts", // looks like docs/, is not
    "mytests/foo.ts", // looks like tests/, is not
    "src/tests/foo.ts", // a tests/ DIRECTORY inside src is source, not the top-level tests/
  ])("%s is NOT safe to skip", (file) => {
    expect(isSafeToSkip(file)).toBe(false);
  });
});

describe("shouldSkipPreview — a PR skips only if EVERY file is safe", () => {
  it("docs-only skips", () => expect(shouldSkipPreview(["docs/a.md", "handoff-status.md"])).toBe(true));
  it("tests-and-e2e-only skips", () => expect(shouldSkipPreview(["tests/a.test.ts", "e2e/b.spec.ts"])).toBe(true));
  it("docs plus tests skips", () => expect(shouldSkipPreview(["docs/a.md", "tests/a.test.ts"])).toBe(true));

  it("one src file in an otherwise docs-only PR builds", () => {
    expect(shouldSkipPreview(["docs/a.md", "src/app/page.tsx"])).toBe(false);
  });
  it("one config file in an otherwise tests-only PR builds", () => {
    expect(shouldSkipPreview(["tests/a.test.ts", "next.config.ts"])).toBe(false);
  });
  it("an EMPTY change list builds (no evidence is not evidence of safety)", () => {
    expect(shouldSkipPreview([])).toBe(false);
  });
});

/** A fake git: maps the joined args to output, throws for anything unlisted (like a failing command). */
function fakeGit(answers: Record<string, string | Error>) {
  const calls: string[] = [];
  const git = (args: string[]) => {
    const key = args.join(" ");
    calls.push(key);
    const hit = Object.entries(answers).find(([k]) => key.startsWith(k));
    if (!hit) throw new Error(`unexpected git ${key}`);
    if (hit[1] instanceof Error) throw hit[1];
    return hit[1];
  };
  return { git, calls };
}

const PREVIEW = { VERCEL_ENV: "preview" };

describe("decide — the Ignored Build Step", () => {
  it("skips a preview whose PR changed only docs and tests", () => {
    const { git } = fakeGit({
      fetch: "",
      "merge-base": "abc123\n",
      "diff --name-only": "docs/x.md\ntests/y.test.ts\n",
    });
    expect(decide({ env: PREVIEW, git })).toMatchObject({ skip: true });
  });

  it("builds a preview that touches src/", () => {
    const { git } = fakeGit({ fetch: "", "merge-base": "abc123\n", "diff --name-only": "docs/x.md\nsrc/app/page.tsx\n" });
    expect(decide({ env: PREVIEW, git })).toMatchObject({ skip: false });
  });

  it("ALWAYS builds production, whatever changed", () => {
    const { git, calls } = fakeGit({ fetch: "", "merge-base": "abc\n", "diff --name-only": "docs/x.md\n" });
    expect(decide({ env: { VERCEL_ENV: "production" }, git })).toMatchObject({ skip: false });
    expect(calls, "production must not even consult git").toEqual([]);
  });

  it("builds when VERCEL_ENV is missing or unknown", () => {
    const { git } = fakeGit({ fetch: "", "merge-base": "abc\n", "diff --name-only": "docs/x.md\n" });
    expect(decide({ env: {}, git }).skip).toBe(false);
    expect(decide({ env: { VERCEL_ENV: "development" }, git }).skip).toBe(false);
  });

  it("builds when git cannot answer — a failure never skips", () => {
    expect(decide({ env: PREVIEW, git: fakeGit({ fetch: new Error("could not read from remote") }).git }).skip).toBe(false);
    expect(decide({ env: PREVIEW, git: fakeGit({ fetch: "", "merge-base": new Error("no merge base") }).git }).skip).toBe(false);
    expect(decide({ env: PREVIEW, git: fakeGit({ fetch: "", "merge-base": "abc\n", "diff --name-only": new Error("bad object") }).git }).skip).toBe(false);
  });

  it("builds when the diff is empty", () => {
    const { git } = fakeGit({ fetch: "", "merge-base": "abc\n", "diff --name-only": "\n" });
    expect(decide({ env: PREVIEW, git }).skip).toBe(false);
  });

  it("diffs the PR against its merge-base with main, never just the last commit", () => {
    const { git, calls } = fakeGit({ fetch: "", "merge-base": "abc123\n", "diff --name-only": "docs/x.md\n" });
    decide({ env: PREVIEW, git });
    expect(calls.some((c) => c.startsWith("merge-base HEAD origin/main"))).toBe(true);
    expect(calls.some((c) => c === "diff --name-only abc123 HEAD")).toBe(true);
  });

  it("states its reason, so the Vercel build log says why", () => {
    const { git } = fakeGit({ fetch: "", "merge-base": "abc\n", "diff --name-only": "docs/x.md\n" });
    expect(decide({ env: PREVIEW, git }).reason).toMatch(/docs|tests|only/i);
  });
});

describe("the wiring", () => {
  it("vercel.json points ignoreCommand at the script", () => {
    const config = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    expect(config.ignoreCommand).toBe("node scripts/vercel-ignore-build.mjs");
  });

  it("the Lighthouse workflow's paths-ignore is EXACTLY the classifier's list", () => {
    const yml = readFileSync(path.join(ROOT, ".github/workflows/lighthouse-budget.yml"), "utf8");
    const block = yml.match(/pull_request:\s*\n(?:\s+.*\n)*?\s+paths-ignore:\s*\n((?:\s+- .*\n)+)/);
    expect(block, "lighthouse-budget.yml has no paths-ignore under pull_request").not.toBeNull();
    const listed = [...block![1].matchAll(/-\s+["']?([^"'\n]+?)["']?\s*$/gm)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...SKIP_PATHS].sort());
  });

  it("every entry in SKIP_PATHS agrees with isSafeToSkip on a sample file", () => {
    const sample: Record<string, string> = { "docs/**": "docs/a.md", "tests/**": "tests/a.ts", "e2e/**": "e2e/a.ts", "*.md": "README.md" };
    for (const p of SKIP_PATHS) expect(isSafeToSkip(sample[p]), `${p} has no matching sample or disagrees`).toBe(true);
    expect(Object.keys(sample).sort()).toEqual([...SKIP_PATHS].sort());
  });
});
