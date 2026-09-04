"use client";

import { useActionState } from "react";
import { sendContactMessageAction } from "@/lib/contact/actions";
import { CONTACT_TOPICS, initialContactActionState } from "@/lib/contact/schemas";
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
