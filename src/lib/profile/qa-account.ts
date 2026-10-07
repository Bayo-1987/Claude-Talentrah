/**
 * What a QA account is (owner, 6-7 Oct 2026): an account whose email contains "+qa-" (the QA Seeker / QA Employer / QA Mentor addresses, hello+qa-*@talentrah.com),
 * or whose name starts with "QA ". Those accounts are owner-authorised test accounts that live on production, so they are kept out of what the public, employers and
 * analytics see: mentor lists and counts, product analytics events, ad analytics. (The Talent Directory and the referral leaderboard are read through SQL and carry
 * the same rule there: public.is_qa_account, S3-21.)
 *
 * The NAME rule is case-SENSITIVE on purpose: a real person called "Qa Hoang" or "Qasim" must never vanish from a list. It is "QA" followed by a space (or exactly
 * "QA"), so "QAnon", "QA-Team" and "Qatar Airways" are not QA names. The EMAIL rule is case-insensitive, as mail addresses are. Pure, so a test, a server loader
 * and the SQL twin's fixture list can all use the same definition (tests/profile/qa-account.test.ts).
 *
 * Which name fields count: the first name, the full visible name (first + last: an account stored as first "QA", last "Seeker" is "QA Seeker"), a mentor's own
 * display_name, and the leaderboard handle. Any one of them is enough.
 */
export const QA_EMAIL_MARKER = "+qa-";

/** True for a name that is exactly "QA" or starts with "QA " (case-sensitive; surrounding whitespace ignored). */
export function isQaName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  return n === "QA" || n.startsWith("QA ");
}

export interface QaAccountFields {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** mentor_profiles.display_name: the name a mentor chose for the public. */
  displayName?: string | null;
  /** profiles.referral_leaderboard_display_name. */
  leaderboardName?: string | null;
}

export function isQaAccount(fields: QaAccountFields): boolean {
  if ((fields.email ?? "").toLowerCase().includes(QA_EMAIL_MARKER)) return true;
  const first = (fields.firstName ?? "").trim();
  const last = (fields.lastName ?? "").trim();
  const full = [first, last].filter(Boolean).join(" ");
  return isQaName(first) || isQaName(full) || isQaName(fields.displayName) || isQaName(fields.leaderboardName);
}
