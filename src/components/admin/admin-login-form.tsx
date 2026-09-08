"use client";

import { useActionState, useState } from "react";
import { adminLoginAction } from "@/lib/admin/actions";
import { initialAdminLoginState } from "@/lib/admin/login-state";
import { TextField, PasswordField, Button } from "@/components/ui";

export function AdminLoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState(
    adminLoginAction,
    initialAdminLoginState,
  );

  /*
   * `PasswordField` owns its own reveal state — see its own header for why —
   * so resetting it on submit means remounting it, not reaching into it.
   * Bumping this key is the same idiom signup-form.tsx already uses to reset
   * its own fields after a submission (see that file's own comment on why a
   * key bump, not an effect, is what actually wins that race).
   *
   * Bumped IN onSubmit, not in an effect keyed on the action's result — an
   * effect there was the first version, and eslint was right to reject it:
   * setState inside an effect re-renders the tree a second time for
   * something an event already knows. Submitting is the event, and it
   * covers the case that matters, because a rejected attempt is one where
   * the person may have walked away from a screen showing their password in
   * clear text.
   */
  const [resetKey, setResetKey] = useState(0);

  return (
    <form
      action={formAction}
      onSubmit={() => setResetKey((k) => k + 1)}
      className="flex flex-col gap-4"
    >
      {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}

      <TextField
        id="admin-email"
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
      />

      <PasswordField
        key={resetKey}
        id="admin-password"
        label="Password"
        name="password"
        autoComplete="current-password"
        required
      />

      {state.error && (
        <p
          role="alert"
          className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust"
        >
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
