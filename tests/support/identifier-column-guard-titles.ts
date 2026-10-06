/**
 * The names of the tests in tests/rls/identifier-column-grants.test.ts, spelled in one place and free of any test-runner import, so the CI guard that fails a run
 * in which a database-only test was skipped (scripts/assert-named-tests-ran.ts) can name them exactly without loading vitest.
 * Full names are what vitest reports: the describe title and the test title joined by a space.
 */
export const IDENTIFIER_TABLES = ["organizations", "scholarships", "blog_posts", "mentorship_reviews"] as const;

/** The columns each table withholds from signed-out visitors and signed-in users (0232). Adding to this list is a decision, not a fix for a failing test. */
export const WITHHELD_IDENTIFIER_COLUMNS: Record<(typeof IDENTIFIER_TABLES)[number], readonly string[]> = {
  organizations: ["cac_number", "cac_business_name", "cac_confirmed_by", "created_by"],
  scholarships: ["moderation_note", "moderated_by"],
  blog_posts: ["created_by", "updated_by"],
  mentorship_reviews: ["reviewer_id", "session_id"],
};

export const IDENTIFIER_DESCRIBE = "identifier columns on four public tables: signed-out visitors and signed-in users read every column except the withheld ones";
export const IDENTIFIER_ROLES = ["a signed-out visitor", "a signed-in user"] as const;

export const identifierNames = {
  found: "found each table's columns (the check is not empty)",
  columns: (role: string, table: string) => `${role}: every column of ${table} except the withheld ones is readable, none was added without a grant, and each withheld one is refused`,
  star: (role: string, table: string) => `${role}: select * on ${table} is stopped`,
  creator: "an employer can still create an organisation and join it, and another user cannot join it",
};

/** The full names vitest reports for the whole file. */
export function identifierGuardFullNames(): string[] {
  const names: string[] = [`${IDENTIFIER_DESCRIBE} ${identifierNames.found}`];
  for (const t of IDENTIFIER_TABLES) for (const r of IDENTIFIER_ROLES) names.push(`${IDENTIFIER_DESCRIBE} ${identifierNames.columns(r, t)}`);
  for (const t of IDENTIFIER_TABLES) for (const r of IDENTIFIER_ROLES) names.push(`${IDENTIFIER_DESCRIBE} ${identifierNames.star(r, t)}`);
  names.push(`${IDENTIFIER_DESCRIBE} ${identifierNames.creator}`);
  return names;
}
