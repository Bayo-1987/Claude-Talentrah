/**
 * Form state for the signup code page's two actions (S1-101). Not in actions.ts: a "use server" module may export only async functions — an object export
 * there compiles, renders, and then 500s on the first submit (same reason src/lib/auth/resend-state.ts exists).
 */
export interface CodeFormState {
  status: "idle" | "error";
  /** A message about the attempt as a whole (wrong code, too many tries, trouble). Announced through the page's status region. */
  message: string | null;
  /** A message about the field itself (not six digits). Linked to the input. */
  fieldError: string | null;
  /** What was typed, so a wrong code does not empty the box. */
  code: string;
  /** The pending signup is gone (cookie expired or cleared): the page shows the "start again" state. */
  ended: boolean;
}

export const initialCodeState: CodeFormState = { status: "idle", message: null, fieldError: null, code: "", ended: false };

export interface ResendCodeState {
  status: "idle" | "success" | "error";
  message: string | null;
  /** Seconds before another code can be asked for, when the action knows (after a send, or when it refused for the minute). */
  cooldownSeconds: number | null;
  ended: boolean;
}

export const initialResendCodeState: ResendCodeState = { status: "idle", message: null, cooldownSeconds: null, ended: false };
