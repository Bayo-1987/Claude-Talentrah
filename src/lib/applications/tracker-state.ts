/**
 * Result shape for the Job Tracker forms (add a job, change a stage). Kept out of tracker-actions.ts because a "use server" module may export nothing but async functions.
 * A refusal is RETURNED, not thrown: a throw inside a form action goes to the route's error boundary and replaces the whole page with "This page couldn't load".
 */
import type { SubmittedValues } from "@/lib/forms/keep-input";

export interface TrackerActionState {
  status: "idle" | "success" | "error";
  message?: string;
  /** Returned with an add-a-job error so the form keeps what was typed (React 19 resets the form after any action). */
  values?: SubmittedValues;
}

export const initialTrackerActionState: TrackerActionState = { status: "idle" };
