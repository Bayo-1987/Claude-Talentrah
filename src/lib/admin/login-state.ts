/**
 * The login form's state, kept out of actions.ts because a "use server" module
 * may only export async functions — a plain object export there fails the
 * build, not at runtime. Same split as src/lib/scholarships/admin-state.ts.
 */
import type { SubmittedValues } from "@/lib/forms/keep-input";

export interface AdminLoginState {
  error: string | null;
  /** The typed EMAIL only, handed back with an error so the form keeps it. Never the password. */
  values?: SubmittedValues;
}

export const initialAdminLoginState: AdminLoginState = { error: null };
