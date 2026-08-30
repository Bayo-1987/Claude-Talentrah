"use client";

import { useActionState } from "react";
import { adminLoginAction } from "@/lib/admin/actions";
import { initialAdminLoginState } from "@/lib/admin/login-state";
import { TextField, Button } from "@/components/ui";

export function AdminLoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState(
    adminLoginAction,
    initialAdminLoginState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}

      <TextField
        id="admin-email"
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
      />
      <TextField
        id="admin-password"
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      {/*
        ALWAYS SHOWN, never conditional. Revealing the field only for accounts
        with a factor would confirm both that the address is an operator's and
        that it has MFA — two facts an attacker holding a freshly reset password
        would like very much. Optional-looking here, enforced on the server for
        anyone actually enrolled.
      */}
      <TextField
        id="admin-code"
        label="Authentication code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="If you have two-factor set up"
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
