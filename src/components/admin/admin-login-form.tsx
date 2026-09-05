"use client";

import { useActionState, useState } from "react";
import { adminLoginAction } from "@/lib/admin/actions";
import { initialAdminLoginState } from "@/lib/admin/login-state";
import { TextField, Button } from "@/components/ui";

/**
 * The password field is written out here rather than using `TextField`.
 *
 * `TextField` renders a label and an input and has no slot for a trailing
 * control. Giving it one would change a component seven other forms depend on
 * in order to serve one field on one page, so the markup is duplicated
 * deliberately — the input's classes are `TextField`'s, copied, and the only
 * additions are the right padding that keeps the value clear of the button and
 * the relative wrapper the button positions against.
 *
 * If a second field ever needs this, that is the moment to put the slot in
 * `TextField`; one is not.
 */
function PasswordField({ revealed, onToggle }: { revealed: boolean; onToggle: () => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor="admin-password"
        className="font-body text-[13px] font-semibold text-ink-soft"
      >
        Password
      </label>

      <div className="relative">
        <input
          id="admin-password"
          name="password"
          /*
           * `text` only while revealed; `password` the rest of the time rather
           * than something clever with a CSS mask, so password managers,
           * autofill and the platform's own "reveal" affordances keep working.
           * `autoComplete` stays `current-password` for the same reason.
           */
          type={revealed ? "text" : "password"}
          autoComplete="current-password"
          required
          className="min-h-11 w-full border-[1.5px] border-ink bg-card py-2.5 pl-3.5 pr-12 font-body text-[15px] text-ink outline-none focus:border-rust"
        />

        {/*
          A real button, and `type="button"` is load-bearing: inside a form a
          bare <button> defaults to type="submit", so revealing the password
          would post the form. An icon-only <div> would avoid that and lose
          keyboard focus and the button role with it.

          44px wide and the full height of the field, so the hit target is the
          whole right edge rather than the glyph — the sizing bug this project
          has shipped before was exactly a target measured by its icon.
        */}
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={revealed}
          aria-controls="admin-password"
          /*
           * The name changes with the state, on top of aria-pressed. Someone
           * who cannot see the field needs to be told the secret is currently
           * on screen, and "Show password, pressed" is a worse way to say that
           * than "Hide password".
           */
          aria-label={revealed ? "Hide password" : "Show password"}
          className={`absolute inset-y-0 right-0 flex w-11 items-center justify-center border-l border-line transition-colors hover:text-rust focus-visible:text-rust focus-visible:outline-none ${
            revealed ? "text-rust" : "text-ink-soft"
          }`}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}

/* Inline SVG, never an emoji — and aria-hidden, because the button is named. */
function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3.25" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1.5 12S5.5 5 12 5c1.6 0 3.05.42 4.32 1.06M20.1 8.2c1.5 1.9 2.4 3.8 2.4 3.8s-4 7-10.5 7c-1.7 0-3.2-.48-4.5-1.2" />
      <path d="M9.9 9.9a3.25 3.25 0 0 0 4.3 4.3" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function AdminLoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState(
    adminLoginAction,
    initialAdminLoginState,
  );

  /*
   * Component state and nothing else. Not localStorage, not a cookie, not a
   * URL parameter — a revealed password that survives the page is a revealed
   * password on someone's next visit, and the whole point of the control is
   * that the person chose to reveal it just now.
   */
  const [revealed, setRevealed] = useState(false);

  return (
    <form
      action={formAction}
      /*
       * Re-hidden the moment it is submitted, not when the result comes back.
       *
       * An effect keyed on the action's result was the first version, and eslint
       * was right to reject it: setState inside an effect re-renders the tree a
       * second time for something an event already knows. Submitting is the
       * event — and it covers the case that matters, because a rejected attempt
       * is one where the person may have walked away from a screen showing
       * their password in clear text.
       */
      onSubmit={() => setRevealed(false)}
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

      <PasswordField revealed={revealed} onToggle={() => setRevealed((v) => !v)} />

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
