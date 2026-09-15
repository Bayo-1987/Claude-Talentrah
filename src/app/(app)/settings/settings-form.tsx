"use client";

import { useActionState } from "react";
import { updateProfileAction } from "@/lib/profile/settings-actions";
import { initialSettingsActionState } from "@/lib/profile/settings-state";
import { SIGNUP_COUNTRIES } from "@/lib/auth/schemas";
import { TextField, SelectField, Button } from "@/components/ui";

export interface SettingsFormProps {
  firstName: string;
  lastName: string;
  country: string | null;
}

export function SettingsForm({ firstName, lastName, country }: SettingsFormProps) {
  const [state, formAction, pending] = useActionState(
    updateProfileAction,
    initialSettingsActionState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.status === "success" && (
        <p className="border-[1.5px] border-green px-3.5 py-2.5 text-[13.5px] text-green">
          Saved.
        </p>
      )}
      {state.error && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
          {state.error}
        </p>
      )}

      <TextField
        label="First name"
        name="firstName"
        defaultValue={firstName}
        autoComplete="given-name"
        required
        error={state.fieldErrors?.firstName?.[0]}
      />
      <TextField
        label="Last name"
        name="lastName"
        defaultValue={lastName}
        autoComplete="family-name"
        required
        error={state.fieldErrors?.lastName?.[0]}
      />
      {/*
        `defaultValue` stated explicitly, including when it is null → "". That
        is what keeps SelectField's placeholder showing for a profile with no
        country rather than silently pre-answering the first option — the
        defect fixed in the primitive, honoured here rather than relied on.
      */}
      <SelectField
        label="Country"
        name="country"
        options={SIGNUP_COUNTRIES}
        defaultValue={country ?? ""}
        required
        error={state.fieldErrors?.country?.[0]}
      />

      <Button type="submit" disabled={pending} className="mt-1 self-start">
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
