import type { PersonRecord } from "./queries";
import type { SubmittedValues } from "@/lib/forms/keep-input";

/**
 * Search result state. Kept out of actions.ts because a `"use server"` module
 * may export nothing but async functions — same split as the other admin
 * action modules.
 */
export interface PersonLookupState {
  status: "idle" | "found" | "not_found" | "error";
  message?: string;
  person?: PersonRecord;
  /** The typed search term, handed back with a real lookup so the box keeps it. */
  values?: SubmittedValues;
}

export const initialPersonLookupState: PersonLookupState = { status: "idle" };
