import { changedColumns, scholarshipRow } from "./ingest";
import { NOTE_NEEDS_STAMP_MESSAGE } from "./public-deadline-note";
import { toNormalizedScholarship, type manualScholarshipSchema } from "./schemas";
import type { z } from "zod";

/**
 * Editing a scholarship listing from /admin/scholarships (owner, 8 Oct 2026): the pure half. The action reads the stored row, the form is parsed by the SAME schema as the
 * add-by-hand form, and this decides the UPDATE.
 *
 *   - Only PENDING and PUBLISHED (`verified`) listings can be edited. A rejected one stays rejected.
 *   - A pending listing stays pending. A published listing whose content CHANGES goes back to pending (moderated_at cleared, the note says which fields and who), exactly the
 *     effect the ingest path already has when a verified listing's content differs, but explicit and attributed. Saved with nothing changed it stays published.
 *   - Identity and verification are not edited here: `dedup_fingerprint` (what ingest matches on) is left as it is, `deadline_verified_at` is kept, `last_checked_at` is not
 *     touched (an edit is not a re-check), and `moderation_status` is written only by the rule above.
 *   - The deadline-note rule approval applies is applied at SAVE: a deadline note on a listing with no verified-deadline stamp is refused with the same message.
 */
export const EDITABLE_STATUSES = ["pending", "verified"] as const;
export const isEditableStatus = (status: string): boolean => (EDITABLE_STATUSES as readonly string[]).includes(status);

/** Shown BEFORE saving, on the edit page of a published listing. */
export const PUBLISHED_EDIT_WARNING = "Saving will take this off the site until it's re-approved.";

export interface StoredScholarshipForEdit {
  id: string;
  moderation_status: string;
  deadline_verified_at: string | null;
  deadline_note: string | null;
  moderation_note: string | null;
  source_name?: string | null;
  dedup_fingerprint: string;
  [column: string]: unknown;
}

export interface ScholarshipEdit {
  /** Set when the deadline-note rule refuses the save; nothing else is meaningful then. */
  refusal: { deadlineNote: string[] } | null;
  update: Record<string, unknown>;
  returnedToReview: boolean;
  /** The content columns that differ from what is stored. */
  changed: string[];
}

export function buildScholarshipEdit(args: {
  parsed: z.infer<typeof manualScholarshipSchema>;
  existing: StoredScholarshipForEdit;
  operator: { adminId: string | null; email: string; displayName?: string | null };
  now: string;
}): ScholarshipEdit {
  const { parsed, existing, operator, now } = args;

  if (parsed.deadlineNote && parsed.deadlineNote.trim() !== "" && !existing.deadline_verified_at) {
    return { refusal: { deadlineNote: [NOTE_NEEDS_STAMP_MESSAGE] }, update: {}, returnedToReview: false, changed: [] };
  }

  // The same row shape ingest writes, with the stored stamp and identity carried over, so the comparison is the ingest path's own.
  const listing = { ...toNormalizedScholarship(parsed), deadlineVerifiedAt: existing.deadline_verified_at };
  const row = scholarshipRow(listing, existing.dedup_fingerprint, now) as Record<string, unknown>;
  // An empty source-name field parses to the schema's default "Manual entry"; a stored null must not count as an edit to that default.
  if (existing.source_name == null && parsed.sourceName === "Manual entry") row.source_name = existing.source_name;
  const changed = changedColumns(row, existing);

  const { dedup_fingerprint: _fingerprint, last_checked_at: _checked, deadline_verified_at: _stamp, ...content } = row; // eslint-disable-line @typescript-eslint/no-unused-vars
  const update: Record<string, unknown> = { ...content };

  const returnedToReview = existing.moderation_status === "verified" && changed.length > 0;
  if (returnedToReview) {
    const who = operator.displayName?.trim() || operator.email;
    update.moderation_status = "pending";
    update.moderated_at = null;
    const reason = `Returned for review: ${changed.join(", ")} edited by ${who}.`;
    update.moderation_note = parsed.reviewNote ? `${reason} ${parsed.reviewNote}` : reason;
  }
  return { refusal: null, update, returnedToReview, changed };
}
