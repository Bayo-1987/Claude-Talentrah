/**
 * The names and shapes the admin jobs uploader shares (PR-U1). No server-only import here, so the tests can use them.
 */
export const JOBS_IMPORT_PERMISSION = "jobs_import" as const;

/** The audit actions, in one list. An audit row holds counts and short codes only: never a title, a company, an address, a link or a database message. */
export const JOBS_IMPORT_AUDIT = {
  requested: "jobs.import_requested",
  finished: "jobs.import_finished",
  denied: "jobs.import_denied",
} as const;

export type AuditDetail = { [key: string]: string | number | null };

export interface AdminRef {
  adminId: string;
  email: string;
  sessionId?: string | null;
}

/** The three audit writes the handlers make. `requested` is STRICT: it throws when the row cannot be written, and then nothing is written to job_postings. */
export interface ImportAudit {
  denied(admin: AdminRef, detail: AuditDetail): Promise<void>;
  requested(admin: AdminRef, detail: AuditDetail): Promise<string>;
  finished(admin: AdminRef, detail: AuditDetail): Promise<void>;
}
