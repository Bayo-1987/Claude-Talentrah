"use client";

import { useActionState } from "react";
import { signInAction, type AuthActionState } from "@/lib/auth/actions";
import { TextField, Button } from "@/components/ui";

const initialState: AuthActionState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

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
        error={state.fieldErrors?.email?.[0]}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={state.fieldErrors?.password?.[0]}
      />

      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? "Logging in…" : "Log in"}
      </Button>
    </form>
  );
}
