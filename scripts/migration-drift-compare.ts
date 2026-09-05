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
