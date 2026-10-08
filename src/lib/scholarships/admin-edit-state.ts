import type { SubmittedValues } from "@/lib/forms/keep-input";

/** State of the edit-a-listing form. Lives outside the "use server" module, which may export only async functions. */
export interface EditScholarshipState {
  status: "idle" | "error";
  /** Message to show above the form. */
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /** The submitted values, handed back with every error so the form keeps what was typed (src/lib/forms/keep-input.ts). A save redirects and hands none. */
  values?: SubmittedValues;
}
export const initialEditScholarshipState: EditScholarshipState = { status: "idle" };
