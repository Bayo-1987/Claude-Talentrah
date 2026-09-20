"use client";

import { useActionState } from "react";
import { sendContactMessageAction } from "@/lib/contact/actions";
import {
  CONTACT_TOPICS,
  CONTACT_HONEYPOT_FIELD,
  initialContactActionState,
} from "@/lib/contact/schemas";
import { TextField, SelectField, Button } from "@/components/ui";

export function ContactForm() {
  const [state, formAction, pending] = useActionState(
    sendContactMessageAction,
    initialContactActionState,
  );

  if (state.status === "success") {
    return (
      <p className="border-[1.5px] border-ink bg-card px-5 py-4 text-[15px] text-ink">
        Thanks — your message is on its way to us. We typically reply within a
        couple of business days.
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

      {/*
        send-405 honeypot: invisible to a real visitor by every path —
        moved off-screen (not display:none/hidden, which naive bots already
        skip), pulled out of the accessibility tree so a screen reader never
        announces it, and out of the Tab order so keyboard navigation never
        lands on it. A bot that fills every input it finds fills this one;
        a human never sees or reaches it. See sendContactMessageAction's own
        comment for what happens when it's filled (silent success, no email).
      */}
      <input
        type="text"
        name={CONTACT_HONEYPOT_FIELD}
        tabIndex={-1}
        aria-hidden="true"
        autoComplete="off"
        className="absolute left-[-9999px] top-[-9999px] h-px w-px overflow-hidden"
      />

      <TextField
        label="Your name"
        name="name"
        autoComplete="name"
        required
        error={state.fieldErrors?.name?.[0]}
      />
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={state.fieldErrors?.email?.[0]}
      />
      <SelectField
        label="Topic"
        name="topic"
        options={CONTACT_TOPICS}
        required
        error={state.fieldErrors?.topic?.[0]}
      />
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="message"
          className="font-body text-[13px] font-semibold text-ink-soft"
        >
          Message
        </label>
        <textarea
          id="message"
          name="message"
          rows={6}
          required
          className="border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust"
        />
        {state.fieldErrors?.message?.[0] && (
          <p className="text-[12.5px] text-rust">{state.fieldErrors.message[0]}</p>
        )}
      </div>

      <Button type="submit" disabled={pending} className="mt-1 self-start">
        {pending ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
