import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
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
 * One page of job-seeker signups, newest first.
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

  let query = supabase
    .from("profiles")
    .select(SIGNUP_COLUMNS, { count: "exact" })
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
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .gt("created_at", sinceIso);

  if (error) throw error;
  return count ?? 0;
}
