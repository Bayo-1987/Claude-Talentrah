import { KNOWN_ALIASES } from "./audit-migrations";

/**
 * The comparison rules from `audit-migrations.ts`'s own SQL (`buildQuery`),
 * reimplemented as a pure function rather than a query string.
 *
 * WHY A SEPARATE, PURE VERSION rather than reusing `buildQuery` and executing
 * it: `check-migration-drift.ts` gets the applied list over HTTPS now (a
 * `SECURITY DEFINER` function, not a direct Postgres connection — see that
 * file's own header), so there is no longer a live SQL connection for
 * `buildQuery`'s generated string to run against. Keeping the comparison as
 * plain TypeScript rather than moving it INTO the database function is
 * deliberate too: `KNOWN_ALIASES` is a per-migration, code-reviewed judgment
 * call (each entry carries its own paragraph of reasoning), and that belongs
 * in a file reviewed the same way the rest of the app is, not in a Postgres
 * function that would need its own migration every time an alias is added.
 * It also means this logic is directly testable with no network or database
 * at all — see migration-drift-compare.test.ts.
 *
 * The three rules are identical to `buildQuery`'s `case` statement: exact
 * name match, a documented alias, or a match after stripping the leading
 * `NNNN_` prefix (migrations applied through the connector with a bare name —
 * see audit-migrations.ts's own migrations table, 0049–0057).
 */

export type MigrationStatus =
  | "applied"
  | "applied under a documented alias"
  | "applied without its numeric prefix"
  | "MISSING";

export interface MigrationCheckResult {
  migration: string;
  status: MigrationStatus;
}

function stripNumericPrefix(name: string): string {
  return name.replace(/^[0-9]{4}_/, "");
}

export function compareMigrations(committed: string[], appliedNames: string[]): MigrationCheckResult[] {
  const applied = new Set(appliedNames);
  const appliedByStrippedName = new Set(appliedNames.map(stripNumericPrefix));

  return committed.map((migration) => {
    if (applied.has(migration)) {
      return { migration, status: "applied" };
    }

    const alias = KNOWN_ALIASES[migration];
    if (alias && applied.has(alias)) {
      return { migration, status: "applied under a documented alias" };
    }

    if (appliedByStrippedName.has(stripNumericPrefix(migration))) {
      return { migration, status: "applied without its numeric prefix" };
    }

    return { migration, status: "MISSING" };
  });
}

/**
 * The mirror of `compareMigrations`: names applied on production that are not
 * committed on main.
 *
 * WHY THIS IS A WARNING AND NOT A FAILURE. Under the apply-before-merge
 * convention (docs/production-migration-apply.md) production is *expected* to
 * be briefly ahead of main — that is the whole point of the ordering, and
 * failing on it would make the convention unusable. What this catches is the
 * convention's residual gap: a migration applied for a PR that is then
 * abandoned or renamed, which otherwise sits on production forever with
 * nothing in the repo describing it. Exactly the situation migrations
 * 0001-0025 left behind.
 *
 * Deliberately reuses the same alias and stripped-prefix tolerances as
 * `compareMigrations`. Without them, every renumbered migration — and this
 * project has renumbered several — would be reported as unexplained in both
 * directions at once, which is noise that would get the warning ignored.
 */
export function findAppliedButNotCommitted(committed: string[], appliedNames: string[]): string[] {
  const committedSet = new Set(committed);
  const committedByStrippedName = new Set(committed.map(stripNumericPrefix));
  // A committed migration may be recorded under a documented alias; those
  // alias names are legitimately on production and must not be reported.
  const knownAliases = new Set(
    committed.map((m) => KNOWN_ALIASES[m]).filter((a): a is string => Boolean(a)),
  );

  return appliedNames.filter((applied) => {
    if (committedSet.has(applied)) return false;
    if (knownAliases.has(applied)) return false;
    if (committedByStrippedName.has(stripNumericPrefix(applied))) return false;
    return true;
  });
}
