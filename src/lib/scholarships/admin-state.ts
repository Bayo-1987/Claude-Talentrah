import type { ModerationStatus } from "./types";

/**
 * State shape for the admin posting form.
 *
 * Lives outside actions.ts because a `"use server"` module may export nothing
 * but async functions — an exported object compiles and renders fine, then
 * 500s the moment the form is submitted. That was a real defect on /feedback;
 * this file exists so it cannot be a second one.
 */

/** One row of the pending queue, in the shape the retired
 *  /api/admin/moderate-scholarship returned and `loadQueueAction` still does. */
export interface PendingScholarship {
  id: string;
  provider: string;
  program_name: string;
  application_deadline: string | null;
  official_url: string;
  moderation_status: ModerationStatus;
  last_checked_at: string | null;
}

export interface AdminScholarshipState {
  status: "idle" | "success" | "error";
  /** Message to show above the form. */
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /**
   * The pending queue, loaded only on a request that carried a valid secret.
   * `null` means "not loaded", which is not the same as "empty" — an empty
   * queue is a real answer and renders as one.
   */
  pending: PendingScholarship[] | null;
  /**
   * True when the saved listing matched an already-published one whose content
   * had changed, so it went back to pending. Worth telling the operator
   * plainly: they did not just add a listing, they took one off the catalog.
   */
  returnedToReview?: boolean;
  /**
   * Whether the last submission's secret checked out. Drives whether the page
   * shows the listing form at all, so an operator isn't filling in twenty
   * fields before finding out the password was wrong.
   */
  unlocked: boolean;
}

export const initialAdminScholarshipState: AdminScholarshipState = {
  status: "idle",
  pending: null,
  unlocked: false,
};
