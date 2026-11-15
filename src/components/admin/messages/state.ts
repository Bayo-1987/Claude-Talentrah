/**
 * Result shape for the admin messaging actions. Kept out of actions.ts because a `"use server"` module may export nothing but async functions.
 */
export interface MessageActionState {
  status: "idle" | "success" | "error";
  message?: string;
  /** What the message belongs to (a message id, a claim id or a limit key), so one banner does not appear on every form. */
  targetId?: string;
}

export const initialMessageActionState: MessageActionState = { status: "idle" };
