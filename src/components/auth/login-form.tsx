"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { signInAction, type AuthActionState } from "@/lib/auth/actions";
import { TextField, PasswordField, Button } from "@/components/ui";
import { RememberedAccountCard } from "@/components/auth/remembered-account-card";
import {
  authCookieSignature,
  clearRememberedEmail,
  readRememberedEmail,
  writeRememberedEmail,
} from "@/lib/auth/remembered-email";

const initialState: AuthActionState = { error: null };

const subscribeToStorage = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  // Only email is controlled — React resets uncontrolled fields after every
  // form action completes (success or failure), which is what we want for
  // password (never re-show a failed password) but not for email (a typo'd
  // password shouldn't also force retyping the email).
  const [email, setEmail] = useState("");

  /*
   * Remembering the email after a SUCCESSFUL email sign-in, and only then (LOGIN-REMEMBERED-ACCOUNT-1).
   *
   * `signInAction` is left exactly as it is, and so is the form's `action` (the server action itself, so a submit before hydration or
   * without JS still works). A failure RESOLVES with an `{ error }` state and the form stays on screen; a success ends in `redirect()`,
   * which navigates away and unmounts this form while the submit still has no result: the client never receives a "success" value to read.
   * So a submit is recorded when it starts, forgotten the moment any result arrives (that is a failure), and counts as a success only if
   * the form is unmounted with the submit still unanswered AND Supabase's auth cookie has appeared or changed since it started. The cookie
   * is only compared, never stored or sent anywhere. Merely leaving the page mid-flight therefore never writes anything.
   */
  const inFlight = useRef<{ email: string; auth: string } | null>(null);
  useEffect(() => {
    if (state !== initialState) inFlight.current = null;
  }, [state]);
  useEffect(
    () => () => {
      const started = inFlight.current;
      if (!started) return;
      const now = authCookieSignature();
      if (now && now !== started.auth) writeRememberedEmail(started.email);
    },
    [],
  );

  // Server render and first paint know nothing about this browser, so the card can only appear after hydration (null on the server).
  const remembered = useSyncExternalStore(subscribeToStorage, readRememberedEmail, () => null);
  const [view, setView] = useState<"card" | "form">("card");
  const focusPasswordNext = useRef(false);

  // "Do not show the card when the last sign-in was through Google": starting a provider sign-in (the sibling Google/LinkedIn forms,
  // recognisable by their hidden `provider` field) forgets the remembered email, so the card is not offered after a sign-in that was not by
  // email. Nothing is ever written on this path, and the provider forms themselves are untouched.
  useEffect(() => {
    const forgetOnProviderSignIn = (e: Event) => {
      if (e.target instanceof HTMLFormElement && e.target.querySelector('input[name="provider"]')) {
        clearRememberedEmail();
      }
    };
    document.addEventListener("submit", forgetOnProviderSignIn, true);
    return () => document.removeEventListener("submit", forgetOnProviderSignIn, true);
  }, []);
  useEffect(() => {
    if (view === "form" && focusPasswordNext.current) {
      focusPasswordNext.current = false;
      document.getElementById("password")?.focus();
    }
  }, [view]);

  if (remembered && view === "card") {
    return (
      <RememberedAccountCard
        email={remembered}
        onContinue={() => {
          setEmail(remembered);
          focusPasswordNext.current = true;
          setView("form");
        }}
        onUseAnother={() => {
          clearRememberedEmail();
          setEmail("");
          setView("form");
        }}
      />
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const typed = new FormData(e.currentTarget).get("email");
        inFlight.current = { email: typeof typed === "string" ? typed : "", auth: authCookieSignature() };
      }}
      className="flex flex-col gap-5"
    >
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
        <PasswordField
          label="Password"
          name="password"
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
          className="inline-flex min-h-6 items-center self-start text-[12.5px] text-ink-soft underline underline-offset-2 hover:text-rust"
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
