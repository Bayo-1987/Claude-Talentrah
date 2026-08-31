/**
 * Result shape for the operator-management forms. Kept out of actions.ts
 * because a `"use server"` module may export nothing but async functions — an
 * exported object compiles fine and then 500s on submit. Same split as
 * src/lib/admin/moderation/state.ts, which exists for the same reason.
 */
export interface OperatorActionState {
  status: "idle" | "success" | "error";
  message?: string;
  /** Which row the message belongs to, so one banner does not appear on all of them. */
  targetId?: string;
}

export const initialOperatorActionState: OperatorActionState = { status: "idle" };
