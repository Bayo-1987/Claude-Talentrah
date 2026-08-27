/**
 * The action's state shape and its initial value, deliberately NOT in
 * actions.ts.
 *
 * A `"use server"` module may only export async functions — every export in
 * one becomes a callable server action, and Next refuses an object at module
 * evaluation with "A 'use server' file can only export async functions, found
 * object". That failure is not a build error: the page compiles, renders, and
 * then 500s when the form posts, which makes it look like the insert failed
 * rather than the module.
 *
 * Found by submitting the form, not by reading the code.
 */
export interface FeedbackActionState {
  status: "idle" | "success" | "error";
  error: string | null;
  fieldErrors?: Record<string, string[]>;
}

export const initialFeedbackActionState: FeedbackActionState = {
  status: "idle",
  error: null,
};
