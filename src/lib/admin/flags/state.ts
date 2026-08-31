/**
 * Result shape for the flag toggles. Kept out of actions.ts because a
 * `"use server"` module may export nothing but async functions — an exported
 * object compiles fine and then 500s on submit.
 */
export interface FlagActionState {
  status: "idle" | "success" | "error";
  message?: string;
  /** Which flag the message belongs to, so one banner does not appear on all. */
  targetKey?: string;
}

export const initialFlagActionState: FlagActionState = { status: "idle" };
