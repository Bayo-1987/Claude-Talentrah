/**
 * Leave QA and owner test accounts out of a `profiles` query, BEFORE it is paged or counted (SIGNUPS-LIST-QA-FILTER).
 *
 * The rule is `isQaAccount` (src/lib/profile/qa-account.ts), the TypeScript twin of `public.is_qa_account` (migrations 0240 and 0251). A page that says "N people, page X of Y"
 * cannot apply it after the rows are fetched: the total, the page count and the page contents would all still include (or have holes for) the accounts it drops. So it has to be
 * part of the query, and PostgREST can only filter on columns, not call `is_qa_account` per row (calling it as a filter answers `column profiles.is_qa_account does not exist`; a
 * set-returning wrapper would be a new database function, which is a migration). So the rule is written once more here, as PostgREST filter groups. That is a copy, and the
 * safeguard is `tests/admin/people-signups-qa-filter.test.ts`: against the real database it checks, case by case, that this filter, `isQaAccount` and `public.is_qa_account` agree.
 *
 * HOW IT READS. Each group below is an `or=(...)` that is TRUE when the row is NOT caught by one clause of the rule; PostgREST ANDs repeated `or` parameters, so a row stays only
 * if no clause catches it (De Morgan). Every group starts with `<column>.is.null` because `NOT (NULL ...)` is NULL in SQL, and a NULL would silently drop a real account that has no
 * name: the failure this exists to prevent in the other direction.
 *
 *   email contains "+qa-", any case             0240    email.ilike %+qa-%
 *   the owner's plus-addresses                  0251    email ~* ^ *stonebridgehibr1\+[a-z0-9._-]+@gmail\.com *$  (spaces around it are trimmed, as btrim does)
 *   first name is "QA" or starts with "QA "     0240    first_name ~ ^ *QA( |$)                                    (case-SENSITIVE; spaces only, as btrim does)
 *   full name is "QA" or starts with "QA "      0240    only differs from the first-name clause when there is no first name: then the last name alone is the full name
 *   leaderboard name is "QA" or "QA ..."        0240    referral_leaderboard_display_name ~ ^ *QA( |$)
 *
 * The mentor display name is not on `profiles`, so it is not a clause here (the SQL function takes it as a fourth argument; the signups list passes the leaderboard name there).
 * Postgres checks `profiles_names_have_visible_characters`, so a blank-only first or last name cannot exist; the "no first name" test still treats a blank one as none, like the rule.
 */
const QA_NAME = '"^ *QA( |$)"';

export const QA_EXCLUSION_GROUPS = [
  'email.is.null,email.not.ilike."%+qa-%"',
  String.raw`email.is.null,email.not.imatch."^ *stonebridgehibr1\\+[a-z0-9._-]+@gmail\\.com *$"`,
  `first_name.is.null,first_name.not.match.${QA_NAME}`,
  `and(first_name.not.is.null,first_name.not.match."^ *$"),last_name.is.null,last_name.not.match.${QA_NAME}`,
  `referral_leaderboard_display_name.is.null,referral_leaderboard_display_name.not.match.${QA_NAME}`,
] as const;

/** Anything with PostgREST's `.or(filters)` that returns itself (every filter builder does). */
interface OrFilterable<T> {
  or(filters: string): T;
}

export function excludeQaAccounts<T extends OrFilterable<T>>(query: T): T {
  let q = query;
  for (const group of QA_EXCLUSION_GROUPS) q = q.or(group);
  return q;
}
