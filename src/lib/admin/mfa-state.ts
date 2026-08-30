/**
 * Enrolment form state. Out of the action module because a `"use server"` file
 * may export nothing but async functions — same split as every other admin
 * action here.
 */
export interface MfaEnrolState {
  status: "idle" | "started" | "error" | "done";
  message?: string;
  /** Present once a factor has been created and is waiting to be verified. */
  factorId?: string;
  secret?: string;
  uri?: string;
}

export const initialMfaEnrolState: MfaEnrolState = { status: "idle" };
