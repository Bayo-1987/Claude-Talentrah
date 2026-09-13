"use client";

import { useActionState, useState } from "react";
import { requestPasswordResetAction, type AuthActionState } from "@/lib/auth/actions";
import { TextField, Button } from "@/components/ui";

const initialState: AuthActionState = { error: null };

/**
 * Ask for the address, nothing else.
 *
 * Same shape as LoginForm deliberately, down to which field is controlled:
 * email is held in state so a validation error does not force retyping it.
 * There is no password here to deliberately forget.
 *
 * There is also no success branch in this component, and that is the
 * anti-enumeration rule showing up in the UI rather than only in the action.
 * A successful submit REDIRECTS to the confirmation page, so this form has no
 * "sent" state it could accidentally render differently for a known address —
 * the only way to get a different answer would be to add one.
 */
export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    requestPasswordResetAction,
    initialState,
  );
  const [email, setEmail] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
          {state.error}
        </p>
      )}

      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={state.fieldErrors?.email?.[0]}
      />

      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
