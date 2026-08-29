"use client";

import { useActionState, useState } from "react";
import { updatePasswordAction, type AuthActionState } from "@/lib/auth/actions";
import { TextField, Button } from "@/components/ui";
import { PasswordRequirements } from "./password-requirements";

const initialState: AuthActionState = { error: null };

/**
 * Set the new password.
 *
 * The password IS controlled here, which is the opposite of LoginForm and for
 * the opposite reason: PasswordRequirements needs the live value to tick its
 * rules off as they are met, exactly as SignupForm does. Both screens import
 * the same component over the same `getPasswordRequirements`, so the rules a
 * user is shown while resetting are the rules they were shown while signing
 * up — one definition, not two that can drift apart.
 *
 * `autoComplete="new-password"`, matching signup: this is a new secret, and
 * telling the password manager so is what gets it offered for saving rather
 * than autofilled with the old one.
 */
export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePasswordAction, initialState);
  const [password, setPassword] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
          {state.error}
        </p>
      )}

      <div className="flex flex-col gap-2.5">
        <TextField
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={state.fieldErrors?.password?.[0]}
        />
        <PasswordRequirements password={password} />
      </div>

      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
