/**
 * Form state for the rename and delete controls on /resume-builder.
 *
 * Not in actions.ts: a `"use server"` module may export only async functions.
 * An object export there compiles, renders, and then 500s on the first submit
 * — which reads as a failed save rather than a failed module. Same reason
 * src/lib/applications/notes-state.ts and src/lib/feedback/state.ts exist.
 */

export interface RenameResumeState {
  status: "idle" | "success" | "error";
  error: string | null;
  /** The title as the database actually stored it, echoed back on success. */
  title: string | null;
}

export const initialRenameResumeState: RenameResumeState = {
  status: "idle",
  error: null,
  title: null,
};

export interface DeleteResumeState {
  status: "idle" | "success" | "error";
  error: string | null;
}

export const initialDeleteResumeState: DeleteResumeState = {
  status: "idle",
  error: null,
};

/**
 * The one sentence explaining why the base resume has no delete button.
 *
 * A disabled control with no reason is worse than no control: the user cannot
 * tell "not allowed" from "not loaded yet". Exported so the UI and the tests
 * assert the same string.
 */
export const BASE_RESUME_UNDELETABLE_REASON =
  "Your base resume can't be deleted — Auto-Apply uses it to submit on your behalf.";
