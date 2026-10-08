/** State of the edit-a-listing form. Lives outside the "use server" module, which may export only async functions. */
export interface EditScholarshipState {
  status: "idle" | "error";
  /** Message to show above the form. */
  error?: string;
  fieldErrors?: Record<string, string[]>;
}
export const initialEditScholarshipState: EditScholarshipState = { status: "idle" };
