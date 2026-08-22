"use client";

import { useActionState, useState } from "react";
import { signUpAction, type AuthActionState } from "@/lib/auth/actions";
import { SIGNUP_COUNTRIES } from "@/lib/auth/schemas";
import { TextField, SelectField, Button } from "@/components/ui";
import { PasswordRequirements } from "./password-requirements";

const initialState: AuthActionState = { error: null };

export function SignupForm({ referredByCode }: { referredByCode?: string }) {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);
  const [fields, setFields] = useState({
    firstName: "",
    lastName: "",
    email: "",
    country: "",
    password: "",
    termsAccepted: false,
  });

  // React's own controlled-value state for the select/checkbox below stays
  // correct across a failed submission (verified directly) — but the
  // browser's native form reset that fires after a <form action={fn}>
  // submission clobbers *their DOM value/checked* afterward, and since
  // React sees no state change on that render it never re-asserts them
  // (text inputs don't have this problem — React's controlled-input value
  // tracker corrects them regardless). Remounting on every completed
  // submission sidesteps it: a fresh element always gets its value from
  // current props, so the native reset has nothing stale to leave behind.
  //
  // Deriving submitCount during render (rather than in a useEffect) is the
  // React-documented pattern for "adjust state when a prop/value changes" —
  // it re-runs the component with the new value before committing, instead
  // of committing stale UI and fixing it up a tick later.
  const [prevState, setPrevState] = useState(state);
  const [submitCount, setSubmitCount] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    setSubmitCount((c) => c + 1);
  }

  function set<K extends keyof typeof fields>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setFields((prev) => ({ ...prev, [key]: e.target.value }));
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {referredByCode && (
        <input type="hidden" name="referredByCode" value={referredByCode} />
      )}

      {state.error && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
          {state.error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <TextField
          label="First name"
          name="firstName"
          autoComplete="given-name"
          required
          value={fields.firstName}
          onChange={set("firstName")}
          error={state.fieldErrors?.firstName?.[0]}
        />
        <TextField
          label="Last name"
          name="lastName"
          autoComplete="family-name"
          required
          value={fields.lastName}
          onChange={set("lastName")}
          error={state.fieldErrors?.lastName?.[0]}
        />
      </div>

      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        value={fields.email}
        onChange={set("email")}
        error={state.fieldErrors?.email?.[0]}
      />

      <SelectField
        key={submitCount}
        label="Country"
        name="country"
        options={SIGNUP_COUNTRIES}
        required
        value={fields.country}
        onChange={set("country")}
        error={state.fieldErrors?.country?.[0]}
      />

      <div className="flex flex-col gap-2">
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={fields.password}
          onChange={set("password")}
          error={state.fieldErrors?.password?.[0]}
        />
        <PasswordRequirements password={fields.password} />
      </div>

      <label className="flex items-start gap-2.5 text-[13px] text-ink-soft">
        <input
          key={submitCount}
          type="checkbox"
          name="termsAccepted"
          required
          checked={fields.termsAccepted}
          onChange={(e) =>
            setFields((prev) => ({ ...prev, termsAccepted: e.target.checked }))
          }
          className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[var(--ink)]"
        />
        I agree to Talentrah&apos;s{" "}
        <a href="/terms" className="underline">
          Terms of Service
        </a>{" "}
        and{" "}
        <a href="/privacy" className="underline">
          Privacy Policy
        </a>
        .
      </label>

      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? "Creating your account…" : "Create a free account"}
      </Button>
    </form>
  );
}
