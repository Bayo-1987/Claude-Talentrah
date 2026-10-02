/**
 * How far an Extend link moves a posting's closing date. The SQL (redeem_job_expiry_extend_token, 0205) owns the actual
 * arithmetic; this is only the number the email and the confirm page quote, kept in one place so the label cannot
 * drift from the interval without a test noticing (tests/jobs/expiry-reminders/migration-shape.test.ts).
 */
export const EXTEND_DAYS = 30;
