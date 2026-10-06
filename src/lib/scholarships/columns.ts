import type { Tables } from "@/lib/supabase/types";

/**
 * Every column of `scholarships` that the signed-in and signed-out roles can read: the whole row except the admin's review trail
 * (`moderation_note`, `moderated_by`), which migration 0232 withholds from them. A read that says `select("*")` needs every column to be
 * readable, so it fails the moment a column is withheld; the loaders below name what they take instead.
 *
 * ONE string literal on purpose: supabase-js reads a query's result type from the literal text of `select(...)`, so a list built with `.join()` or
 * `+` would widen to `string` and the rows would lose their typed columns. tests/lib/identifier-columns-readable-lists.test.ts holds this list to the
 * generated types (every column except the two withheld ones, nothing else) so a column added to the table reaches a page only when someone decides it
 * should.
 *
 * Narrower lists exist where a page needs less: PUBLIC_COLUMNS (src/lib/scholarships/public.ts, the detail page) and LANDING_PREVIEW_COLUMNS
 * (src/lib/seo/landing-page-data.ts, the four rows on the signed-out landing page). This is the wide one, for the list page, the landing-page
 * listings and the actions that load a listing to act on it.
 */
export const SCHOLARSHIP_READABLE_COLUMNS =
  "id, provider, program_name, host_institution, degree_levels, field_tags, funding_type, funding_covers, eligibility_nationalities, eligibility_prior_degree, eligibility_age, eligibility_other, application_deadline, close_time, close_tz, close_at, deadline_note, deadline_verified_at, cycle_year, official_url, source_name, moderation_status, moderated_at, last_checked_at, dedup_fingerprint, created_at, updated_at";

/** A scholarship row as the signed-in and signed-out roles see it: every column but the admin's review trail. */
export type ScholarshipRow = Omit<Tables<"scholarships">, "moderation_note" | "moderated_by">;
