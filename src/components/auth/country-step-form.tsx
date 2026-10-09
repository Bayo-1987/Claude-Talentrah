"use client";

import { useActionState, useState } from "react";
import { saveGoogleCountryAction } from "@/lib/auth/google-country-actions";
import { initialCountryStepState } from "@/lib/auth/country-step-state";
import { SIGNUP_COUNTRIES } from "@/lib/auth/countries";
import { inputValue, selectKey } from "@/lib/forms/keep-input";
import { Button, SelectField } from "@/components/ui";

/**
 * The Google country step's form. The country list is the sign-up form's own (src/lib/auth/countries.ts, one list). `suggested` is the country the browser's locale
 * maps to, or null: it only PRE-SELECTS the box and nothing is saved until Continue is pressed; the hint under the box shows only while the box still holds that suggestion.
 * Empty submit: the server answers "Select a country to continue." and saves nothing.
 */
export function CountryStepForm({ suggested, next }: { suggested: string | null; next: string }) {
  const [state, formAction] = useActionState(saveGoogleCountryAction, initialCountryStepState);
  const initial = inputValue(state.values, "country", suggested);
  const [chosen, setChosen] = useState<string>(suggested ?? "");
  const current = state.values ? inputValue(state.values, "country") : chosen;
  const showHint = suggested !== null && current === suggested;

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5 border-[1.5px] border-ink bg-card p-6">
      <input type="hidden" name="next" value={next} />
      <SelectField
        key={selectKey(state.values, "country")}
        label="Country"
        name="country"
        autoComplete="country-name"
        placeholder="Select your country"
        options={SIGNUP_COUNTRIES}
        defaultValue={initial}
        onChange={(e) => setChosen(e.target.value)}
        error={state.status === "error" ? state.message : undefined}
      />
      {showHint && <p className="-mt-3 text-[13.5px] text-ink-soft">Suggested from your browser. Change it if it&apos;s wrong.</p>}
      <Button type="submit" size="md" className="w-full">
        Continue to my dashboard
      </Button>
    </form>
  );
}
