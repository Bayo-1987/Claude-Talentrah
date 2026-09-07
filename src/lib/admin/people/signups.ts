/**
 * The list's rules, with no database in them.
 *
 * WHY THIS FILE IS PURE. Two of the three things that can go wrong here are
 * decidable without a database — what fields reach the screen, and whether
 * paging arithmetic can hand back more rows than a page — so they live in
 * functions that a test can call directly. The third (does the query really
 * apply these filters) needs a real database and is the honest limit of what
 * can be checked here.
 *
 * ── THIS PAGE REVERSES A DELIBERATE DESIGN, ON PURPOSE ────────────────────
 *
 * /admin/people is a one-person-at-a-time billing lookup and says so in its
 * own comments: no list, no pagination, "the absence is the feature". That page
 * is untouched and its reasoning still holds for it. This is a separate
 * capability, asked for after the trade was spelled out: the operator can now
 * enumerate seekers, and the deterrent that the old page relied on — that
 * fishing was impossible rather than merely discouraged — does not apply here.
 *
 * What replaces it is that browsing is RECORDED. `people.listed` is written for
 * the list itself, not only for opening one person, because a page showing
 * fifty people is not one lookup.
 */

/**
 * Fixed, not caller-supplied.
 *
 * A `pageSize` read from the query string is a way to ask for the whole table
 * with `?pageSize=100000`, which is the thing this page exists not to do. The
 * page number is user-controlled; how much each page holds is not.
 */
export const PAGE_SIZE = 50;

/** How often the "new since you loaded this" counter re-checks. */
export const POLL_INTERVAL_MS = 60_000;

export interface SignupListSpec {
  page: number;
  /** Partial, case-insensitive email match. Already escaped for LIKE. */
  email?: string;
  /** Inclusive lower bound, ISO date (YYYY-MM-DD). */
  from?: string;
  /** Inclusive upper bound, ISO date (YYYY-MM-DD). */
  to?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function firstValue(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/**
 * `%` and `_` are wildcards to `ilike`, so a term of `%` would match every
 * person on the platform — a "search" that quietly becomes "list everything".
 * Escaping them keeps a partial match partial. Backslash first, or it would
 * escape the escapes.
 */
export function escapeLikeTerm(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function validDate(raw: string | undefined): string | undefined {
  if (!raw || !ISO_DATE.test(raw)) return undefined;
  // Rejects 2026-02-31 and friends: Date accepts them and rolls over, so the
  // round trip is what actually validates.
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10) === raw ? raw : undefined;
}

export function parseSignupListParams(
  params: Record<string, string | string[] | undefined>,
): SignupListSpec {
  const rawPage = Number.parseInt(firstValue(params.page) ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawEmail = (firstValue(params.email) ?? "").trim().toLowerCase();
  // Capped so the term cannot become a denial-of-service on the index, and
  // because no real address is longer than this.
  const email = rawEmail ? escapeLikeTerm(rawEmail.slice(0, 320)) : undefined;

  let from = validDate(firstValue(params.from));
  let to = validDate(firstValue(params.to));
  // A backwards range would silently return nothing and read as "no signups".
  // Swapping is the reading the operator meant.
  if (from && to && from > to) [from, to] = [to, from];

  return { page, email, from, to };
}

/** Half-open upper bound, so a `to` of 2026-09-07 includes all of that day. */
export function toExclusiveBound(to: string): string {
  const next = new Date(`${to}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

export function fromInclusiveBound(from: string): string {
  return `${from}T00:00:00.000Z`;
}

/** Supabase `.range()` is inclusive at both ends, which is the classic off-by-one. */
export function pageRange(page: number): { from: number; to: number } {
  const start = (page - 1) * PAGE_SIZE;
  return { from: start, to: start + PAGE_SIZE - 1 };
}

/** What the audit entry records about a view. Filters, never the rows. */
export function describeFilters(spec: SignupListSpec): {
  [key: string]: string | number | boolean | null;
} {
  return {
    page: spec.page,
    page_size: PAGE_SIZE,
    email_filter: spec.email ?? null,
    from: spec.from ?? null,
    to: spec.to ?? null,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * The projection
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The ONLY columns this page reads.
 *
 * Used as the literal `select()` argument, so widening what the screen can show
 * means editing this line — it cannot happen by a join being added elsewhere or
 * by `profiles` gaining a column.
 */
export const SIGNUP_COLUMNS =
  "id, email, first_name, last_name, country, created_at, credits_balance, market_segment, referred_by" as const;

export interface SignupRow {
  id: string;
  email: string;
  /** Display name, or null when the person never gave one. */
  name: string | null;
  country: string | null;
  createdAt: string;
  creditsBalance: number;
  marketSegment: string;
  referredBy: string | null;
  /** Referrer's email when it resolves, else null — never invented. */
  referredByEmail: string | null;
}

/**
 * Field-by-field, deliberately, and never a spread.
 *
 * `{ ...row }` would forward whatever the row happens to carry, which is
 * exactly how resume, application or tailoring data would arrive on this page
 * the day someone widens a select or adds a join upstream. `profiles` already
 * carries `free_trial_tailoring_used` and `farah_hint_dismissed_at`; neither
 * belongs here, and the test asserts they do not appear even when handed in.
 */
export function toSignupRow(
  row: Record<string, unknown>,
  referrerEmails: ReadonlyMap<string, string> = new Map(),
): SignupRow {
  const first = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const last = typeof row.last_name === "string" ? row.last_name.trim() : "";
  const name = [first, last].filter(Boolean).join(" ").trim();
  const referredBy = typeof row.referred_by === "string" ? row.referred_by : null;

  return {
    id: String(row.id),
    email: String(row.email),
    name: name || null,
    country: typeof row.country === "string" ? row.country : null,
    createdAt: String(row.created_at),
    creditsBalance: typeof row.credits_balance === "number" ? row.credits_balance : 0,
    marketSegment: typeof row.market_segment === "string" ? row.market_segment : "unknown",
    referredBy,
    referredByEmail: referredBy ? (referrerEmails.get(referredBy) ?? null) : null,
  };
}

/**
 * Names the fields this page must never show, so the rule is greppable and the
 * test does not have to restate it.
 */
export const FORBIDDEN_ON_THIS_PAGE = [
  "resume",
  "resumes",
  "resume_content",
  "applications",
  "application_history",
  "tailoring",
  "tailoring_history",
  "tailored_resumes",
  "free_trial_tailoring_used",
  "free_trial_cover_letter_used",
] as const;
