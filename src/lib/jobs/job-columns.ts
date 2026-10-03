/**
 * The columns of `job_postings` that a page reads through the visitor's or the employer's own client, named once.
 *
 * A read that says `select("*")` takes every column on the table, so it works only while every column is readable by whoever is asking,
 * and it quietly fetches columns nobody renders. Both loaders below used to do that. They name what they use instead, so the query
 * shows the page's real dependency on the table, and a column added to `job_postings` later reaches a page only when someone decides
 * the page needs it. tests/jobs/job-postings-explicit-columns.test.ts holds the rule (no `select("*")` on this table anywhere in src/)
 * and checks these lists against the generated types.
 */

/*
 * Each list is ONE string literal on purpose: supabase-js reads a query's result type from the literal text of `select(...)`, so a list
 * built with `.join()` or `+` would widen to `string` and the result would lose its typed columns.
 */

/**
 * Everything the public job page, its structured data and its share image can show: every column of the row EXCEPT the search vector
 * (a tsvector used only by the database's own text search, never rendered) and the one internal column the admin tools write. One
 * string so the page and the share image, which are separate requests, read the same row.
 */
export const JOB_DETAIL_COLUMNS =
  "id, organization_id, claimed_by_organization_id, claimed_at, source_type, external_source, external_url, title, company_name, company_logo_url, banner_path, location, work_type, employment_type, seniority, years_experience_min, salary_min, salary_max, salary_currency, salary_unit, description, description_preview, structured_jd, status, posted_at, expires_at, closed_at, closing_date_source, last_checked_at, llm_enrichment_attempted_at, dedup_fingerprint, unlisted_at, removed_at, removed_by, removal_reason, superseded_at, superseded_by, admin_review_requested_at, admin_review_decision, admin_reviewed_at, admin_reviewed_by, created_at";

/** What the employer's edit form loads: the fields the form edits, plus the ids the page needs to address the row. */
export const JOB_EDIT_COLUMNS =
  "id, organization_id, title, location, description, work_type, employment_type, seniority, years_experience_min, expires_at, salary_min, salary_max, salary_currency, salary_unit, structured_jd, banner_path";
