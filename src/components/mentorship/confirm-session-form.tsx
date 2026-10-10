"use client";

import { useActionState } from "react";
import { confirmMentorSessionAction } from "@/lib/mentorship/actions";
import { initialConfirmSessionState } from "@/lib/mentorship/confirm-state";
import { Button } from "@/components/ui";

/**
 * One session's Confirm button on the mentor page. The result shows IN PLACE (QA MENTOR-CONFIRM-1): the loser of a two-tab confirm sees "already confirmed" or "no longer available" next to the row
 * instead of the whole page crashing. Once the session is confirmed, or can no longer be, the button goes (pressing it again can only repeat the answer).
 */
export function ConfirmSessionForm({ sessionId }: { sessionId: string }) {
  const [state, formAction, pending] = useActionState(confirmMentorSessionAction, initialConfirmSessionState);
  const settled = state.status === "already_confirmed" || state.status === "unavailable" || state.status === "confirmed";

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      {!settled && (
        <div>
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "Confirming…" : "Confirm"}
          </Button>
        </div>
      )}
      {state.status !== "idle" && state.message && (
        <p role="status" className={"text-[13.5px] " + (state.status === "error" || state.status === "unavailable" ? "text-rust" : "text-ink")}>
          {state.message}
        </p>
      )}
    </form>
  );
}
