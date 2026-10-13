import type { SubmittedValues } from "@/lib/forms/keep-input";

/** What the Google country step's Continue reports. Its own file: a "use server" module may export nothing but async functions. */
export interface CountryStepState {
  status: "idle" | "error";
  message?: string;
  /** What was chosen, handed back with an error so the select keeps it (src/lib/forms/keep-input.ts). */
  values?: SubmittedValues;
}

export const initialCountryStepState: CountryStepState = { status: "idle" };

export const COUNTRY_REQUIRED_MESSAGE = "Select a country to continue.";
export const COUNTRY_SAVE_FAILED_MESSAGE = "We couldn't save that just now. Please try again.";
