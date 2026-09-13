"use client";

import { useActionState } from "react";
import {
  sendTalentDirectoryContactRequestAction,
  type ContactRequestResult,
} from "@/lib/talent-directory/actions";
import { Button } from "@/components/ui";

const initialState: { status: "idle" } | ContactRequestResult = { status: "idle" };

/**
 * send-157 — an employer's own "Request contact" form. Nothing here ever
 * carries the candidate's real contact details: a successful send just means
 * the candidate now has a pending request to decide on, not that anything
 * was revealed. See contact-runner.ts's own header on why the reveal only
 * ever happens over email, on approval, never through a page an employer's
 * browser could load.
 */
export function ContactRequestForm({ candidateId }: { candidateId: string }) {
  const [state, formAction, pending] = useActionState(
    sendTalentDirectoryContactRequestAction.bind(null, candidateId),
    initialState,
  );

  if (state.status === "success") {
    return (
      <p className="border-[1.5px] border-ink bg-card px-3.5 py-2.5 text-[13.5px] text-ink">
        Request sent — the candidate will see it and decide whether to connect.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2.5 border-[1.5px] border-ink bg-card p-4">
      <label htmlFor="contact-message" className="font-body text-[13px] font-semibold text-ink-soft">
        A short note introducing why you&apos;re reaching out
      </label>
      <textarea
        id="contact-message"
        name="message"
        rows={4}
        required
        placeholder="What the role is, and why their profile stood out."
        className="border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[14px] text-ink outline-none placeholder:font-display placeholder:text-[13.5px] placeholder:italic placeholder:text-ink-soft focus:border-rust"
      />
      {state.status === "error" && <p className="text-[12.5px] text-rust">{state.message}</p>}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Sending…" : "Request contact"}
      </Button>
    </form>
  );
}
