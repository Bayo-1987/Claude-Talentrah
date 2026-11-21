"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { confirmUnsubscribeAction } from "./actions";
import { COPY, NOT_WORKING_COPY } from "./copy";
import type { UnsubscribablePreference } from "./preference";
import { ResubscribeButton } from "./resubscribe-button";

/**
 * What a person sees when they open an unsubscribe link: the question, and a button. Nothing has changed yet. The button is the POST (a server action); on success the page says so and offers the
 * undo for the same token and kind, because a person can still press it by mistake.
 */
export function ConfirmUnsubscribe({ token, preference }: { token: string; preference: UnsubscribablePreference }) {
  const [state, setState] = useState<"idle" | "working" | "done" | "didnt_work">("idle");

  if (state === "done") {
    const done = COPY[preference].unsubscribed;
    return (
      <>
        <h1 className="text-[32px] leading-[1.25]">{done.heading}</h1>
        <p className="text-[15.5px] text-ink-soft">{done.body}</p>
        <ResubscribeButton token={token} preference={preference} />
      </>
    );
  }
  if (state === "didnt_work") {
    return (
      <>
        <h1 className="text-[32px] leading-[1.25]">{NOT_WORKING_COPY.heading}</h1>
        <p className="text-[15.5px] text-ink-soft">{NOT_WORKING_COPY.body}</p>
      </>
    );
  }

  const ask = COPY[preference].confirm;
  return (
    <>
      <h1 className="text-[32px] leading-[1.25]">{ask.heading}</h1>
      <p className="text-[15.5px] text-ink-soft">{ask.body}</p>
      <div>
        <Button
          type="button"
          disabled={state === "working"}
          onClick={async () => {
            setState("working");
            setState((await confirmUnsubscribeAction(token, preference)) === "done" ? "done" : "didnt_work");
          }}
        >
          {state === "working" ? "Unsubscribing…" : "Unsubscribe"}
        </Button>
      </div>
    </>
  );
}
