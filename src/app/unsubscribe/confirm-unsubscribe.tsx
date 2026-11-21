"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { confirmUnsubscribeFormAction, type ConfirmState } from "./actions";
import { COPY, NOT_WORKING_COPY } from "./copy";
import type { UnsubscribablePreference } from "./preference";
import { ResubscribeButton } from "./resubscribe-button";

/**
 * What a person sees when they open an unsubscribe link: the question, and a button. Nothing has changed yet. The button submits a real <form> whose action is the server action (the token and the kind
 * are hidden fields), so it works with JavaScript off: the server renders the page again with the answer. On success the page says so and offers the undo for the same token and kind, because a person
 * can still press it by mistake.
 */
export function ConfirmUnsubscribe({ token, preference }: { token: string; preference: UnsubscribablePreference }) {
  const [state, formAction, pending] = useActionState<ConfirmState, FormData>(confirmUnsubscribeFormAction, { status: "idle" });

  if (state.status === "done") {
    const done = COPY[preference].unsubscribed;
    return (
      <>
        <h1 className="text-[32px] leading-[1.25]">{done.heading}</h1>
        <p className="text-[15.5px] text-ink-soft">{done.body}</p>
        <ResubscribeButton token={token} preference={preference} />
      </>
    );
  }
  if (state.status === "didnt_work") {
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
      <form action={formAction}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="pref" value={preference} />
        <Button type="submit" disabled={pending}>
          {pending ? "Unsubscribing…" : "Unsubscribe"}
        </Button>
      </form>
    </>
  );
}
