/**
 * The fixed vocabulary of the admin-produced data export (docs/admin-data-export.md). No server-only import: the admin form and the tests read it too.
 *
 * Everything here that goes into an audit row is a CODE from a fixed list or a value validated by pattern, never free text, because free text is where personal data gets into a log
 * that is kept for three years.
 */

export const DATA_EXPORT_PERMISSION = "data_export" as const;

/** The private bucket (0263). Public = false and no storage policies: only the service role reaches it. */
export const DATA_EXPORT_BUCKET = "data-exports";

/** A `generating` row older than this belongs to nobody any more (the SQL in 0263 uses the same number). */
export const STALE_ATTEMPT_MINUTES = 15;

/** How long a finished export can be opened (0263's finish function sets the end date from this same number). */
export const EXPORT_VALID_HOURS = 72;

/** The audit actions this feature writes: EXACTLY this list (tests/data-export/audit-actions.test.ts). `admin_audit_log.action` is text (0060), so none needs a migration. */
export const EXPORT_AUDIT_ACTIONS = {
  requested: "people.export_requested",
  noticeSent: "people.export_notice_sent",
  generated: "people.export_generated",
  downloaded: "people.export_downloaded",
  deleted: "people.export_deleted",
  denied: "people.export_denied",
  finished: "people.export_finished",
  cancelled: "people.export_cancelled",
} as const;

/** Why a start (or a cancel) was refused after the caller was authorised. One code per refusal, from this list only; each ends in a `people.export_finished` row. */
export const REFUSAL_CODES = [
  "in_progress",
  "live_export_exists",
  "own_account",
  "admin_target_needs_other_admin",
  "no_such_person",
  "not_a_uuid",
  "notice_failed",
  "not_cancellable",
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];

/** How a start (or cancel) ended, in the `outcome` of its `people.export_finished` row. */
export const FINISH_OUTCOMES = ["completed", "failed", "refused", "superseded", "cancelled"] as const;
export type FinishOutcome = (typeof FINISH_OUTCOMES)[number];

/** Why an object was deleted, in the `reason` of a `people.export_deleted` row. */
export const DELETE_REASONS = ["downloaded", "expired", "failed", "stream_failed", "orphan", "cancelled"] as const;
export type DeleteReason = (typeof DELETE_REASONS)[number];

/** The reason for the export: a pick-list, not free text. */
export const REASON_CODES = ["access_request", "portability_request", "account_support"] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** How support satisfied itself that the requester owns the account (the owner's rule: the signed-in contact form where possible, otherwise a reply from the registered address). */
export const REQUESTER_CHECKS = ["contact_form", "registered_address_reply"] as const;
export type RequesterCheck = (typeof REQUESTER_CHECKS)[number];

/**
 * A support ticket reference: letters, digits, dot, dash and underscore, 3 to 40 characters, starting with a letter or digit. It cannot hold an at sign or a space, so an email address
 * or a sentence does not pass for one.
 */
export const TICKET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$/;

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The object path of one attempt: <export id>/<attempt id>.json. Two attempts never share one. */
export function objectPathFor(exportId: string, attemptId: string): string {
  return `${exportId}/${attemptId}.json`;
}

/** The pattern a bucket object's name must match to be a valid export. Anything else in the bucket is an orphan by definition. */
export const OBJECT_NAME_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;

export function parseObjectName(path: string): { exportId: string; attemptId: string } | null {
  const m = OBJECT_NAME_PATTERN.exec(path);
  return m ? { exportId: m[1], attemptId: m[2] } : null;
}

/** The link in the second email. The id in it is the export's id; opening it is useless without being signed in as the account it belongs to. */
export function exportLinkFor(siteOrigin: string, exportId: string): string {
  return `${siteOrigin}/data-export/${exportId}`;
}
