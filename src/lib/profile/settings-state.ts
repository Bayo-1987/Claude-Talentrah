import type { SubmittedValues } from "@/lib/forms/keep-input";

/**
 * Not in settings-actions.ts: a `"use server"` module may export only async
 * functions. An object export there compiles, renders, and then 500s on the
 * first submit — which reads as a failed save rather than a failed module.
 * That cost an hour once already; see src/lib/feedback/state.ts.
 */
export interface SettingsActionState {
  status: "idle" | "success" | "error";
  error: string | null;
  fieldErrors?: Record<string, string[]>;
  /** Returned with an error so the form keeps what was typed (React 19 resets the form after any action); none on a success. */
  values?: SubmittedValues;
}

export const initialSettingsActionState: SettingsActionState = {
  status: "idle",
  error: null,
};
