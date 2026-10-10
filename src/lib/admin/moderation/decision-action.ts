import type { ModerationState } from "@/lib/admin/moderation/state";
import { submittedValues } from "@/lib/forms/keep-input";

type Action = (prev: ModerationState, formData: FormData) => Promise<ModerationState>;

/**
 * How long after a success the row's removal still counts as "the decision removed it". Generous on purpose: a slow revalidation (a busy server, a slow phone) removes the row seconds
 * after the action returns. Past it, a row that goes is not a consequence of the decision (the person has left the page, say) and announcing it would show a stale message.
 */
export const ANNOUNCE_WINDOW_MS = 30_000;

export interface PendingAnnouncement {
  message: string;
  /** When the success happened (ms since the epoch). */
  at: number;
}

export interface WrapOptions {
  /** The note field's name (the form's `noteName`). */
  noteName: string;
  /** Called with a success's message and the time it happened, so the form can remember it. Omitted: nothing is remembered. */
  onSuccess?: (message: string, at: number) => void;
  /** Test seam; defaults to Date.now. */
  now?: () => number;
}

/**
 * The message a form owes the admin layout's notice when it goes away, or null.
 *
 * DECISION-SILENT-2. The first version decided "the row was removed" by looking at the page once, 600 ms after the success. A revalidation that took longer removed the row AFTER that look, so the
 * confirmation was never announced (QA saw it missing in 1 run of 12, even after 10 s). Now nothing is timed: the form remembers its success, and when the form itself is torn down within
 * ANNOUNCE_WINDOW_MS of it, the message is due, however late the row went. A row that stays never unmounts, so it shows its own banner and is not announced twice.
 */
export function announcementDueAtUnmount(pending: PendingAnnouncement | null, now: number): string | null {
  if (!pending) return null;
  return now - pending.at <= ANNOUNCE_WINDOW_MS ? pending.message : null;
}

/**
 * The shared DecisionForm's one wrapper around whichever Server Action a queue passes it (eight callers, none touched).
 *
 *  - DECISION-NOTE-1: React 19 resets a `<form action>` after the action, so the plain note a reviewer typed came back empty after any error. An error now comes back with the typed note
 *    (src/lib/forms/keep-input.ts), which the note box uses as its default. An action that returns its own values keeps them; a success returns none, so the next note box starts clean.
 *  - DECISION-SILENT-1/2: a success with a message is handed to `onSuccess` so the form can announce it if the decision removes the row (see announcementDueAtUnmount).
 */
export function wrapDecisionAction(action: Action, options: WrapOptions): Action {
  const { noteName, onSuccess, now = Date.now } = options;
  return async (prev, formData) => {
    const result = await action(prev, formData);
    if (result.status === "error") {
      return result.values ? result : { ...result, values: submittedValues(formData, [noteName]) };
    }
    if (result.status === "success" && result.message && onSuccess) onSuccess(result.message, now());
    return result;
  };
}
