/**
 * Vercel "Ignored Build Step" (wired in vercel.json as `ignoreCommand`).
 *
 * Exit 0 = skip this build. Exit 1 = build it. ANY doubt builds: a skipped preview that should have built hides a
 * regression, while a built preview that could have been skipped only costs a deployment.
 *
 * WHAT IT SKIPS: a PREVIEW build, and only when every file the PR changes is docs, tests or e2e:
 *   docs/**, tests/**, e2e/**, and markdown at the repo root (handoff-status.md, CLAUDE.md, README.md).
 * Markdown anywhere else (src/, supabase/, scripts/) still builds: it is not known to be inert.
 *
 * WHAT IT NEVER SKIPS: production, ever (VERCEL_ENV must be exactly "preview"); anything under src/, public/,
 * supabase/, scripts/ or .github/; package.json, lockfiles, next/vercel/ts config.
 *
 * THE DIFF IS THE WHOLE PR, not the last commit: merge-base with main to HEAD. Lighthouse's `paths-ignore`
 * (.github/workflows/lighthouse-budget.yml) is evaluated against the whole PR, and it waits for the preview of the
 * PR's head. If this looked only at the last commit, a docs-only push on top of a src change would skip the
 * preview while Lighthouse still ran, waiting for a deployment that was never made. Both lists are SKIP_PATHS,
 * and tests/ci/preview-skip.test.ts fails if they drift apart.
 *
 * If git cannot answer (no network to fetch main, no merge base, odd history) it builds.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Shared, as written, with the Lighthouse workflow's `paths-ignore` (pinned equal by a test). */
export const SKIP_PATHS = ["docs/**", "tests/**", "e2e/**", "*.md"];

/** Whether ONE changed file can be skipped. */
export function isSafeToSkip(file) {
  if (file.startsWith("docs/") || file.startsWith("tests/") || file.startsWith("e2e/")) return true;
  // Root-level markdown only: no "/" in the path.
  return !file.includes("/") && file.endsWith(".md");
}

/** A PR skips only if it changed something, and everything it changed is skippable. */
export function shouldSkipPreview(files) {
  return files.length > 0 && files.every(isSafeToSkip);
}

/**
 * @param {{ env: Record<string, string | undefined>, git: (args: string[]) => string }} input
 * @returns {{ skip: boolean, reason: string }}
 */
export function decide({ env, git }) {
  if (env.VERCEL_ENV !== "preview") {
    return { skip: false, reason: `VERCEL_ENV is ${env.VERCEL_ENV ?? "unset"}, not "preview": always build` };
  }
  try {
    // Vercel clones shallow. Deepen if it can; an already-complete clone says so with an error we ignore.
    try {
      git(["fetch", "--no-tags", "--unshallow", "origin"]);
    } catch {
      // already complete, or not allowed to: the merge-base below decides whether that mattered
    }
    git(["fetch", "--no-tags", "origin", "+main:refs/remotes/origin/main"]);
    const base = git(["merge-base", "HEAD", "origin/main"]).trim();
    // --no-renames: with rename detection (git's default) a move of src/x.ts to docs/x.ts lists ONLY docs/x.ts,
    // which would skip a build that deletes a source file. Without it the deleted src/ path is listed too.
    const files = git(["diff", "--name-only", "--no-renames", base, "HEAD"])
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
    if (files.length === 0) return { skip: false, reason: "no changed files found against main: build" };
    if (shouldSkipPreview(files)) {
      return { skip: true, reason: `only docs/tests/e2e/root-markdown changed (${files.length} file(s)): preview skipped` };
    }
    const first = files.find((f) => !isSafeToSkip(f));
    return { skip: false, reason: `${first} is not docs/tests/e2e: build` };
  } catch (err) {
    return { skip: false, reason: `could not diff against main (${err instanceof Error ? err.message.split("\n")[0] : "unknown"}): build` };
  }
}

function main() {
  const { skip, reason } = decide({
    env: process.env,
    git: (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  });
  console.log(`[ignore-build] ${skip ? "SKIP" : "BUILD"}: ${reason}`);
  process.exit(skip ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
