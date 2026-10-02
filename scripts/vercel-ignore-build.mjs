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
 *
 * VERCEL'S CHECKOUT HAS NO `origin`. It is a shallow, single-branch clone and the remote is not usable (the first
 * version fetched main from `origin` and failed on every build: "[ignore-build] BUILD: could not diff against
 * main (Command failed: git fetch --no-tags origin +main:refs/remotes/origin/main)"). So main is fetched BY URL,
 * built from Vercel's own VERCEL_GIT_REPO_OWNER / VERCEL_GIT_REPO_SLUG (never hard-coded), into a ref of our own.
 * The repo is public; if it ever stops being, the fetch fails and every preview builds again, as it did before.
 * main is fetched 200 deep; if the PR's own history (also shallow) does not reach the merge-base, the PR's branch
 * (VERCEL_GIT_COMMIT_REF) is deepened, 200 at a time, up to three times; still no merge-base means build.
 * IGNORE_BUILD_GIT_BASE_URL replaces "https://github.com" and exists so the tests can stand a local directory in
 * for GitHub; it is not set on Vercel.
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

const MAIN_REF = "refs/remotes/ignore-build/main";
const DEPTH = 200;
const MAX_DEEPENS = 3;
const PLAIN_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * @param {{ env: Record<string, string | undefined>, git: (args: string[]) => string }} input
 * @returns {{ skip: boolean, reason: string }}
 */
export function decide({ env, git }) {
  if (env.VERCEL_ENV !== "preview") {
    return { skip: false, reason: `VERCEL_ENV is ${env.VERCEL_ENV || "unset"}, not "preview": always build` };
  }

  const owner = env.VERCEL_GIT_REPO_OWNER;
  const slug = env.VERCEL_GIT_REPO_SLUG;
  const missing = [!owner && "VERCEL_GIT_REPO_OWNER", !slug && "VERCEL_GIT_REPO_SLUG"].filter(Boolean);
  if (missing.length > 0) {
    return { skip: false, reason: `${missing.join(" and ")} not set by Vercel, so main cannot be located: build` };
  }
  // The URL is assembled from these two values: only plain names, so nothing can add a path, a host or an option.
  if (!PLAIN_NAME.test(owner) || !PLAIN_NAME.test(slug)) {
    return { skip: false, reason: "VERCEL_GIT_REPO_OWNER/SLUG are not plain names: build" };
  }
  const base = (env.IGNORE_BUILD_GIT_BASE_URL || "https://github.com").replace(/\/+$/, "");
  const url = `${base}/${owner}/${slug}.git`;

  try {
    git(["fetch", "--no-tags", `--depth=${DEPTH}`, url, `+main:${MAIN_REF}`]);

    const mergeBase = () => {
      try {
        return git(["merge-base", "HEAD", MAIN_REF]).trim() || null;
      } catch {
        return null;
      }
    };
    let base_ = mergeBase();
    for (let i = 0; i < MAX_DEEPENS && !base_; i++) {
      const branch = env.VERCEL_GIT_COMMIT_REF;
      if (!branch) {
        return { skip: false, reason: "PR history does not reach main and VERCEL_GIT_COMMIT_REF is not set to deepen it: build" };
      }
      git(["fetch", "--no-tags", `--deepen=${DEPTH}`, url, `refs/heads/${branch}`]);
      base_ = mergeBase();
    }
    if (!base_) return { skip: false, reason: "no merge-base with main within the fetched history: build" };

    // --no-renames: with rename detection (git's default) a move of src/x.ts to docs/x.ts lists ONLY docs/x.ts,
    // which would skip a build that deletes a source file. Without it the deleted src/ path is listed too.
    const files = git(["diff", "--name-only", "--no-renames", base_, "HEAD"])
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
  // Which of Vercel's variables this build actually has (names only), so a missing one shows in the build log.
  const names = ["VERCEL_ENV", "VERCEL_GIT_REPO_OWNER", "VERCEL_GIT_REPO_SLUG", "VERCEL_GIT_COMMIT_REF", "VERCEL_GIT_PREVIOUS_SHA"];
  console.log(`[ignore-build] env: ${names.map((n) => `${n}=${process.env[n] ? "set" : "unset"}`).join(" ")}`);
  const { skip, reason } = decide({
    env: process.env,
    git: (args) =>
      execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        // A hung fetch must not stall the build, and a private repo must fail, not prompt for credentials.
        timeout: 90_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      }),
  });
  console.log(`[ignore-build] ${skip ? "SKIP" : "BUILD"}: ${reason}`);
  process.exit(skip ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
