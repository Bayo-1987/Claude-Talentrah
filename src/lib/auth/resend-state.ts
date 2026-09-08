/**
 * Form state for the check-email resend actions.
 *
 * Not in actions.ts: a `"use server"` module may export only async functions
 * — an object export there compiles, renders, and then 500s on the first
 * submit. Same reason src/lib/resume-builder/list-state.ts exists.
 */
export interface ResendState {
  status: "idle" | "success" | "error";
  message: string | null;
}

export const initialResendState: ResendState = { status: "idle", message: null };
