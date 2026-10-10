/**
 * What a mentor's Confirm button reports (QA MENTOR-CONFIRM-1). Kept out of actions.ts because a "use server" module may export nothing but async functions.
 * `already_confirmed` and `unavailable` are the two ways the loser of a two-tab confirm can end; neither is an error the page should crash on.
 */
export interface ConfirmSessionState {
  status: "idle" | "confirmed" | "already_confirmed" | "unavailable" | "error";
  message?: string;
}

export const initialConfirmSessionState: ConfirmSessionState = { status: "idle" };

export const ALREADY_CONFIRMED_MESSAGE = "This session is already confirmed. Nothing more to do.";
export const UNAVAILABLE_MESSAGE = "This booking is no longer available: it may have been cancelled or has expired.";
export const CONFIRM_ERROR_MESSAGE = "We could not confirm that session just now. Please try again.";
