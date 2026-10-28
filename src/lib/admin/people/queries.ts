import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { excludeQaAccounts } from "./exclude-qa";
import {
  SIGNUP_COLUMNS,
  fromInclusiveBound,
  pageRange,
  toExclusiveBound,
  toSignupRow,
  type SignupListSpec,
  type SignupRow,
} from "./signups";

export interface SignupPage {
  rows: SignupRow[];
  /** Total matching the filters, not the whole table. */
  total: number;
  page: number;
  pageCount: number;
}

/**
 * WHO COUNTS AS A SIGNUP, written once. Every read of "the people on the Signups page" starts here: the `profiles` table with QA and owner test accounts left out (exclude-qa.ts). The list, the new-since counter, the nav's total and the
 * nav's employer count all call this, so the number in the nav is the page's own total by construction and not by two queries agreeing (tests/admin/signups-scope-wiring.test.ts fails on a read that builds its own).
 *
 * The page lists everyone with an account: an employer is an ordinary account that also belongs to an organisation, so they are rows here too.
 */
export function signupsScope(
  supabase: ReturnType<typeof createServiceRoleClient>,
  columns: string,
  options?: { count?: "exact"; head?: boolean },
) {
  return excludeQaAccounts(supabase.from("profiles").select(columns, options));
}

/**
 * One page of signups (everyone with an account, job seekers and employers), newest first. QA and owner test accounts are not listed or counted.
 *
 * SERVICE ROLE, like every other admin read. `profiles` is not readable by an
 * operator's session — there is no operator Supabase session at all (see
 * docs/admin-auth.md) — so the permission check happens in the page, before
 * this is called, and this trusts its caller. That is the same arrangement the
 * billing lookup uses.
 *
 * `count: "exact"` is what makes a page count possible, and it is the one place
 * this page pays for knowing how many people exist. It is scoped by the same
 * filters as the rows, so it counts the result set rather than the platform.
 */
export async function listSignups(spec: SignupListSpec): Promise<SignupPage> {
  const supabase = createServiceRoleClient();
  const { from, to } = pageRange(spec.page);

  // QA and owner test accounts are left out IN THE QUERY, before the range and the count, so the total, the page count and every page are of real accounts only (see exclude-qa.ts).
  let query = signupsScope(supabase, SIGNUP_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (spec.email) query = query.ilike("email", `%${spec.email}%`);
  if (spec.from) query = query.gte("created_at", fromInclusiveBound(spec.from));
  if (spec.to) query = query.lt("created_at", toExclusiveBound(spec.to));

  const { data, error, count } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const referrerEmails = await resolveReferrerEmails(rows);

  const total = count ?? 0;
  return {
    rows: rows.map((r) => toSignupRow(r, referrerEmails)),
    total,
    page: spec.page,
    pageCount: Math.max(1, Math.ceil(total / (to - from + 1))),
  };
}

/**
 * Turn the referrer ids on THIS page into emails, in one query.
 *
 * An id tells an operator nothing they can act on; the email is the thing they
 * would otherwise paste into the lookup tool anyway. Only the referrers of rows
 * already on screen are resolved — this cannot become a second enumeration.
 */
async function resolveReferrerEmails(
  rows: readonly Record<string, unknown>[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      rows
        .map((r) => r.referred_by)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  ];
  if (ids.length === 0) return new Map();

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("profiles").select("id, email").in("id", ids);
  // Not fatal: a missing referrer email degrades to showing the id, which is
  // still true. Failing the whole page over a nicety would be worse.
  if (error) {
    console.error("[people] could not resolve referrer emails:", error.message);
    return new Map();
  }

  return new Map((data ?? []).map((r) => [r.id as string, r.email as string]));
}

/**
 * How many signups landed after `sinceIso`.
 *
 * A COUNT AND NOTHING ELSE, which is what makes it safe to poll. It returns no
 * personal data, so it writes no audit entry — see the note on `people.listed`
 * in the page. If this ever starts returning rows, it needs to start logging.
 */
export async function countSignupsSince(sinceIso: string): Promise<number> {
  const supabase = createServiceRoleClient();
  // The same exclusion as the list: the badge says "N new", and N must not include the owner's own test accounts.
  const { count, error } = await signupsScope(supabase, "id", { count: "exact", head: true }).gt("created_at", sinceIso);

  if (error) throw error;
  return count ?? 0;
}

/**
 * `onlyIds` narrows a count to the given profile ids, through the SAME scope (QA accounts are still left out). Production callers pass nothing: the nav asks for the whole table. It exists so a test can count among accounts it created itself,
 * which no other test file can change, instead of comparing two reads of a table other files are adding to and removing from while the test runs.
 */
export interface SignupCountOptions {
  onlyIds?: readonly string[];
}

/**
 * How many people the Signups page lists, with no filter: its unfiltered total, for the admin nav.
 *
 * A HEAD-ONLY COUNT through the same scope as the list, so it fetches no row and carries no personal data, and writes no audit entry for the same reason `countSignupsSince` does not. The page writes `people.listed` because it SHOWS people;
 * the nav shows a number.
 */
export async function countSignups(options: SignupCountOptions = {}): Promise<number> {
  const supabase = createServiceRoleClient();
  const everyone = signupsScope(supabase, "id", { count: "exact", head: true });
  const { count, error } = await (options.onlyIds ? everyone.in("id", [...options.onlyIds]) : everyone);
  if (error) throw error;
  return count ?? 0;
}

/**
 * How many of those people belong to an organisation: the employers, counted as PEOPLE, once each.
 *
 * Counted from the profiles side through the same scope as `countSignups`, so the same QA exclusion applies to the member's own profile and E can never exceed N. The inner embed keeps only profiles that have at least one membership
 * and returns each profile once however many organisations it belongs to; counting `organizations` or `organization_members` rows instead would count companies or memberships. A membership always has a profile
 * (organization_members.user_id references profiles(id)), so there is no member to miss.
 */
export async function countSignupEmployers(options: SignupCountOptions = {}): Promise<number> {
  const supabase = createServiceRoleClient();
  const members = signupsScope(supabase, "id, organization_members!inner(user_id)", { count: "exact", head: true });
  const { count, error } = await (options.onlyIds ? members.in("id", [...options.onlyIds]) : members);
  if (error) throw error;
  return count ?? 0;
}
