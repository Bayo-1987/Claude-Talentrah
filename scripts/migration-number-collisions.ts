/**
 * Does this branch add a migration whose number `main` has already taken?
 *
 * ── SIX COLLISIONS, AND THE CONVENTION ONLY FIRES AFTER THE DAMAGE ────────
 *
 * 0060/0061, 0103/0104, 0106/0107, 0110/0111 (twice in one afternoon), and
 * 0113 twice. At least three of those took `main` red — `supabase db reset`
 * inserts one row per migration keyed on the filename's numeric prefix, so two
 * files sharing a number is a primary-key collision that kills the CI stack
 * BEFORE any test runs. The failure then looks like it belongs to whatever
 * branch you happen to be on, which is the expensive part.
 *
 * "Whichever merges second renames" is the right fix and this repo applies it
 * consistently. It just cannot fire until after a red main, because nothing
 * compares the numbers until both files are already sitting in the same tree.
 *
 * ── WHY THIS COMPARES AGAINST FRESH `main`, NOT THE MERGE BASE ────────────
 *
 * This is the whole point, and a merge-base comparison would have caught NONE
 * of the six. Every one of them was a number that was free when the branch was
 * cut and taken by the time it merged — that is what a collision IS. The
 * merge-base is `main` as it was at branch time, which is precisely the state
 * in which the number looked available.
 *
 * So the caller fetches `origin/main` at job start and passes what is on it
 * NOW. This function then answers one question: does any number this branch
 * introduces already exist over there?
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * It does not check for gaps, or that numbers ascend, or that a branch adds
 * only one. Gaps are legitimate and this repo has them (a renumber leaves the
 * old slot empty; 0114b exists on a branch). Flagging those would train people
 * to ignore the check, which is worse than not having it.
 *
 * IT ALSO CANNOT CLOSE THE RACE ON ITS OWN. Two open PRs can each pass this
 * against a `main` that has neither of them, and the second to land still
 * collides — a PR-time check sees `main` as it is when it runs, not as it will
 * be after a concurrent merge. GitHub's "Require branches to be up to date
 * before merging" is what forces a re-run against the latest `main` at merge
 * time, and that setting is what actually closes it. This check is the half
 * that lives in the repo.
 */

export interface Collision {
  /** The four-digit prefix both files claim. */
  number: string;
  /** The file this branch adds. */
  incoming: string;
  /** Every file already on `main` carrying that number. */
  existing: string[];
}

/**
 * The numeric prefix of a migration filename, or null if it has none.
 *
 * Anchored and exactly four digits followed by `_`, which is the convention
 * every file in supabase/migrations/ follows. Anything else returns null and
 * is IGNORED rather than reported: this check's job is collisions, and a file
 * that does not participate in the numbering scheme cannot collide with one
 * that does. A naming-convention check is a different check, and bundling it
 * here would make this one noisy enough to start being skipped.
 */
export function migrationNumber(filename: string): string | null {
  const base = filename.slice(filename.lastIndexOf("/") + 1);
  const match = /^(\d{4})_/.exec(base);
  return match ? match[1] : null;
}

/**
 * Every number this branch introduces that `main` already uses.
 *
 * `incoming` is the set of migration files the branch ADDS — not every file it
 * has. A branch that merely edits an existing migration is not colliding with
 * itself, and passing the whole directory would report every file on both
 * sides as a collision with itself.
 */
export function findCollisions(incoming: string[], onMain: string[]): Collision[] {
  const takenByNumber = new Map<string, string[]>();
  for (const file of onMain) {
    const number = migrationNumber(file);
    if (!number) continue;
    takenByNumber.set(number, [...(takenByNumber.get(number) ?? []), file]);
  }

  const collisions: Collision[] = [];
  for (const file of incoming) {
    const number = migrationNumber(file);
    if (!number) continue;

    /*
     * A file that is on both sides is the same file, not a collision — this
     * happens when a branch is behind and the diff still lists it. Compared by
     * basename so a path prefix difference cannot make one look like two.
     */
    const existing = (takenByNumber.get(number) ?? []).filter(
      (other) => basename(other) !== basename(file),
    );
    if (existing.length > 0) {
      collisions.push({ number, incoming: file, existing });
    }
  }
  return collisions;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The message CI prints. Both sides named, because "0113 collides" without the
 * filenames sends the reader to `git log` to find out with what — and the two
 * filenames are usually enough to know immediately which one should renumber.
 */
export function describeCollisions(collisions: Collision[]): string {
  if (collisions.length === 0) return "No migration-number collisions with origin/main.";

  const lines = [
    collisions.length === 1
      ? "A migration on this branch reuses a number already taken on origin/main:"
      : `${collisions.length} migrations on this branch reuse numbers already taken on origin/main:`,
    "",
  ];
  for (const c of collisions) {
    lines.push(`  ${c.number}  this branch:  ${basename(c.incoming)}`);
    for (const other of c.existing) {
      lines.push(`        already on main:  ${basename(other)}`);
    }
    lines.push("");
  }
  lines.push(
    "Two files sharing a number is a primary-key collision in",
    "supabase_migrations.schema_migrations, so `supabase db reset` fails before any",
    "test runs — on main, for everyone, not just on this branch.",
    "",
    "This repo's convention is that whichever lands SECOND renumbers (0060/0061,",
    "0103/0104, 0106/0107, 0110/0111, 0113). Rename the file above to the next",
    "free number, update any references to it, and push again.",
  );
  return lines.join("\n");
}
