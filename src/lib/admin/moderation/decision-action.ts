import type { ModerationState } from "@/lib/admin/moderation/state";
import { submittedValues } from "@/lib/forms/keep-input";

type Action = (prev: ModerationState, formData: FormData) => Promise<ModerationState>;

/** How long after a success the row is checked: the response that removes a row commits with the action's result, so a short wait is enough to tell "removed" from "still there". */
export const ROW_GONE_CHECK_MS = 600;

export interface WrapOptions {
  /** The note field's name (the form's `noteName`). */
  noteName: string;
  /** True when the row's form is no longer on the page (the decision removed it). Read after the wait, never during the action. */
  rowIsGone: () => boolean;
  /** Where a confirmation for a removed row goes (the admin layout's notice). Omitted: nothing is announced. */
  announce?: (message: string) => void;
  /** Test seam; defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => unknown;
}

/**
 * The shared DecisionForm's one wrapper around whichever Server Action a queue passes it (eight callers, none touched).
 *
 *  - DECISION-NOTE-1: React 19 resets a `<form action>` after the action, so the plain note a reviewer typed came back empty after any error. An error now comes back with the typed note
 *    (src/lib/forms/keep-input.ts), which the note box uses as its default. An action that returns its own values keeps them; a success returns none, so the next note box starts clean.
 *  - DECISION-SILENT-1: a success whose row has been removed by the same response is announced through `announce`, because the row's own banner went with it. A row that is still on the page
 *    shows its own banner and is not announced twice.
 */
export function wrapDecisionAction(action: Action, options: WrapOptions): Action {
  const { noteName, rowIsGone, announce, schedule = (fn, ms) => setTimeout(fn, ms) } = options;
  return async (prev, formData) => {
    const result = await action(prev, formData);
    if (result.status === "error") {
      return result.values ? result : { ...result, values: submittedValues(formData, [noteName]) };
    }
    if (result.status === "success" && result.message && announce) {
      const message = result.message;
      schedule(() => {
        if (rowIsGone()) announce(message);
      }, ROW_GONE_CHECK_MS);
    }
    return result;
  };
}
