"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { resubscribeAction } from "./actions";
import type { UnsubscribablePreference } from "./preference";

/**
 * Undo, in one click and with no sign-in.
 *
 * An unsubscribe link can be fired by a mail client's link scanner without the
 * person ever seeing it. Without a way back, that silently costs them a
 * channel they had chosen to keep — so the same token that switched it off
 * switches it on again.
 */
const CONFIRMATION_COPY: Record<UnsubscribablePreference, string> = {
  job_match_digest: "You're subscribed again — the weekly job-match email will keep coming.",
  proactive_match_alert:
    "You're subscribed again — you'll hear from Farah if an exceptional match turns up.",
};

export function ResubscribeButton({
  token,
  preference,
}: {
  token: string;
  preference: UnsubscribablePreference;
}) {
  const [state, setState] = useState<"idle" | "working" | "done" | "failed">("idle");

  if (state === "done") {
    return <p className="text-[15.5px] text-ink">{CONFIRMATION_COPY[preference]}</p>;
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={state === "working"}
        onClick={async () => {
          setState("working");
          setState((await resubscribeAction(token, preference)) ? "done" : "failed");
        }}
      >
        {state === "working" ? "Undoing…" : "Actually, keep sending them"}
      </Button>
      {state === "failed" && (
        <p className="text-[13.5px] text-rust">
          That didn&apos;t work. Reply to any Talentrah email and we&apos;ll fix it by hand.
        </p>
      )}
    </div>
  );
}
