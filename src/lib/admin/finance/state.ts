import type { PersonRecord } from "./queries";

/**
 * Search result state. Kept out of actions.ts because a `"use server"` module
 * may export nothing but async functions — same split as the other admin
 * action modules.
 */
export interface PersonLookupState {
  status: "idle" | "found" | "not_found" | "error";
  message?: string;
  person?: PersonRecord;
}

export const initialPersonLookupState: PersonLookupState = { status: "idle" };
