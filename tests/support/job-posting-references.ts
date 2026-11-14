/**
 * Every foreign key that points at job_postings (JOBS-LIFECYCLE-1): 19 other tables and the self-link, 20 foreign keys at origin/main eefb85a3 with migrations 0277 and 0278 applied. Derived from the catalog
 * of a database with every migration applied. Shared by the migration shape test and the database spec; the database spec ALSO re-derives it from the live catalog and fails on any difference, so a table
 * added later has to be added here and to public.job_posting_delete_unreferenced on purpose.
 */
export const JOB_POSTING_REFERENCES: Array<[table: string, column: string]> = [
  ["ad_campaigns", "job_posting_id"],
  ["ad_events", "job_posting_id"],
  ["applicant_messages", "job_posting_id"],
  ["application_assessment_submissions", "job_posting_id"],
  ["applications", "job_posting_id"],
  ["apply_link_clicks", "job_posting_id"],
  ["auto_apply_queue", "job_posting_id"],
  ["country_default_events", "job_posting_id"],
  ["employer_applicant_notifications", "job_posting_id"],
  ["interview_bookings", "job_posting_id"],
  ["interview_offers", "job_posting_id"],
  ["job_expiry_reminders", "job_posting_id"],
  ["job_posting_assessments", "job_posting_id"],
  ["job_posting_reports", "job_posting_id"],
  ["job_posting_screening_questions", "job_posting_id"],
  ["job_postings", "superseded_by"],
  ["job_tailoring_requests", "source_job_posting_id"],
  ["match_scores", "job_posting_id"],
  ["proactive_match_alerts", "job_posting_id"],
  ["resumes", "tailored_for_job_id"],
];

/**
 * The foreign keys the delete function deliberately does NOT check (the Reviewer's ruling, 14 Nov 2026): derived data and telemetry that goes with the job (four cascade, country_default_events is set
 * null). Everything else in JOB_POSTING_REFERENCES BLOCKS deletion. job_posting_reference_report() carries the same five names as an explicit constant; the database spec holds the two equal.
 */
export const JOB_POSTING_EXEMPT_TABLES = ["match_scores", "country_default_events", "apply_link_clicks", "proactive_match_alerts", "job_expiry_reminders"] as const;

/** The 15 that block: every reference that is not exempt. */
export const JOB_POSTING_BLOCKING: Array<[table: string, column: string]> = JOB_POSTING_REFERENCES.filter(([t]) => !(JOB_POSTING_EXEMPT_TABLES as readonly string[]).includes(t));
