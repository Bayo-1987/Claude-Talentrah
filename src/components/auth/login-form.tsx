"use client";

import { useActionState, useState } from "react";
import { signInAction, type AuthActionState } from "@/lib/auth/actions";
import { TextField, Button } from "@/components/ui";

const initialState: AuthActionState = { error: null };

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  // Only email is controlled — React resets uncontrolled fields after every
  // form action completes (success or failure), which is what we want for
  // password (never re-show a failed password) but not for email (a typo'd
  // password shouldn't also force retyping the email).
  const [email, setEmail] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {/*
        Same hidden-field pattern SignupForm uses for referredByCode. The
        action re-validates it — a hidden field is a form value, not a trusted
        one.
      */}
      {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}

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
      <div className="flex flex-col gap-1.5">
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={state.fieldErrors?.password?.[0]}
        />
        {/*
          UNDER the field rather than beside its label, which is the more
          common placement and is avoided on purpose: the label row is where
          this form says what a field IS, and a link there competes with that
          for the same glance. Here it reads as the next thing to try after the
          password, which is when it is wanted.

          Quiet by design — ink-soft, no button chrome. Someone who knows their
          password should not be invited to reset it.
        */}
        <a
          href="/forgot-password"
          className="self-start text-[12.5px] text-ink-soft underline underline-offset-2 hover:text-rust"
        >
          Forgot password?
        </a>
      </div>

      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? "Logging in…" : "Log in"}
      </Button>
    </form>
  );
}
