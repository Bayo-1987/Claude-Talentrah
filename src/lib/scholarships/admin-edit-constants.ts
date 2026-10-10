/**
 * The client-safe half of editing a scholarship listing: the words and the status rule. No imports on purpose: the edit form is a client component and must not pull the ingest
 * writer or the service-role client into the browser bundle (admin-edit.ts does, through `scholarshipRow`).
 */
export const EDITABLE_STATUSES = ["pending", "verified"] as const;
export const isEditableStatus = (status: string): boolean => (EDITABLE_STATUSES as readonly string[]).includes(status);

/** Shown BEFORE saving, on the edit page of a published listing. */
export const PUBLISHED_EDIT_WARNING = "Saving will take this off the site until it's re-approved.";
