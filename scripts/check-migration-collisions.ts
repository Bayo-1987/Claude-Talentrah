import { execFileSync } from "node:child_process";
import { findCollisions, describeCollisions } from "./migration-number-collisions";

/**
 * CI wrapper: fetch `main` fresh, ask what this branch adds, fail if a number
 * is already taken.
 *
 * Thin on purpose — every judgment lives in migration-number-collisions.ts,
 * which is unit-tested with fixtures for all six collisions this repo has
 * actually had. This file only gathers the two lists.
 *
 * ── THE FETCH IS THE POINT ────────────────────────────────────────────────
 *
 * `git fetch origin main` runs HERE, at job start, rather than relying on
 * whatever the checkout left behind. A collision is by definition a number
 * that was free when the branch was cut, so comparing against a stale `main`
 * — or against the merge-base, which is `main` AS IT WAS AT BRANCH TIME —
 * would have passed all six. The whole check is "what does main look like
 * right now", and that is only true if it is fetched right now.
 */
const MIGRATIONS_DIR = "supabase/migrations";

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function main(): void {
  try {
    /*
     * NO `--depth=1`, and that is a correction rather than an omission.
     *
     * The first version used it as an optimisation — a shallow fetch is enough
     * to read main's tree, and Actions checkouts are shallow anyway. But
     * `git fetch --depth=1` does not just fetch shallowly, it TRUNCATES the
     * repository it runs in. Running this script once on a full local clone
     * left that clone shallow: merge-base stopped resolving, and a two-commit
     * feature branch started reporting itself 575 commits ahead of main.
     *
     * Found by running the script locally and then trying to rebase, which is
     * exactly what anyone doing `npm run check-migration-collisions` before
     * pushing would have hit. CI never would have — it gets a fresh checkout
     * every run, so the damage was invisible on the surface this was written
     * for.
     *
     * A plain fetch is correct in both places: the CI job checks out with
     * `fetch-depth: 0`, and a developer's clone stays whole.
     */
    git("fetch", "--no-tags", "origin", "main");
  } catch (err) {
    console.error("Could not fetch origin/main, so this check cannot run:", err);
    process.exit(1);
  }

  /*
   * Files present on this branch and NOT on main today. Two-dot on purpose:
   * three-dot would compare against the merge base, which is exactly the state
   * in which every one of these numbers still looked free.
   */
  const added = git(
    "diff",
    "--diff-filter=A",
    "--name-only",
    "FETCH_HEAD",
    "HEAD",
    "--",
    MIGRATIONS_DIR,
  )
    .split("\n")
    .filter(Boolean);

  const onMain = git("ls-tree", "--name-only", "FETCH_HEAD", `${MIGRATIONS_DIR}/`)
    .split("\n")
    .filter(Boolean);

  /*
   * An empty `onMain` means the fetch or the path is wrong, not that main has
   * no migrations — and a check that silently passes because it looked in the
   * wrong place is worse than no check. This repo's own standing lesson: an
   * empty result is a claim.
   */
  if (onMain.length === 0) {
    console.error(
      `Found no migrations at all on origin/main under ${MIGRATIONS_DIR}/.\n` +
        "That is almost certainly this check looking in the wrong place rather than\n" +
        "the truth, so it is failing instead of passing vacuously.",
    );
    process.exit(1);
  }

  console.log(
    `origin/main has ${onMain.length} migration(s); this branch adds ${added.length}` +
      (added.length ? `: ${added.map((f) => f.split("/").pop()).join(", ")}` : "."),
  );

  const collisions = findCollisions(added, onMain);
  const report = describeCollisions(collisions);

  if (collisions.length === 0) {
    console.log(report);
    return;
  }
  console.error(`\n${report}\n`);
  process.exit(1);
}

main();
