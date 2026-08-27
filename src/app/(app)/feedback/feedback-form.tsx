"use client";

import { useActionState } from "react";
import { submitFeedbackAction } from "@/lib/feedback/actions";
import { initialFeedbackActionState } from "@/lib/feedback/state";
import { FEEDBACK_CATEGORIES } from "@/lib/feedback/schemas";
import { SelectField, Button } from "@/components/ui";

export interface FeedbackFormProps {
  /**
   * The page they left in order to come here, already validated server-side.
   *
   * Not `document.referrer`: after a client-side navigation the referrer still
   * names whatever was last loaded from the network, so it would be stale or
   * empty for exactly the person who clicked Feedback from the job feed. The
   * masthead passes the real path instead.
   */
  pagePath: string | null;
}

export function FeedbackForm({ pagePath }: FeedbackFormProps) {
  const [state, formAction, pending] = useActionState(
    submitFeedbackAction,
    initialFeedbackActionState,
  );

  if (state.status === "success") {
    return (
      <p className="border-[1.5px] border-ink bg-card px-5 py-4 text-[15px] text-ink">
        Thanks — that&apos;s with us. We read everything sent here, though we
        can&apos;t reply to each one individually.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
          {state.error}
        </p>
      )}

      {pagePath && <input type="hidden" name="pagePath" value={pagePath} />}

      {/*
        No `defaultValue=""` here any more — SelectField does it for every
        caller that states neither `value` nor `defaultValue`. This form
        carried the workaround alone for one commit; the defect was the
        primitive's.
      */}
      <SelectField
        label="What's this about?"
        name="category"
        options={FEEDBACK_CATEGORIES}
        placeholder="Pick one…"
        required
        error={state.fieldErrors?.category?.[0]}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="message" className="font-body text-[13px] font-semibold text-ink-soft">
          Tell us what happened
        </label>
        <textarea
          id="message"
          name="message"
          rows={7}
          required
          placeholder="The more specific, the more useful — what you were doing, and what you expected instead."
          className="border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none placeholder:font-display placeholder:text-[14px] placeholder:italic placeholder:text-ink-soft focus:border-rust"
        />
        {state.fieldErrors?.message?.[0] && (
          <p className="text-[12.5px] text-rust">{state.fieldErrors.message[0]}</p>
        )}
      </div>

      <Button type="submit" disabled={pending} className="mt-1 self-start">
        {pending ? "Sending…" : "Send feedback"}
      </Button>
    </form>
  );
}
