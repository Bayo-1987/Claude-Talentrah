"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { isSignupCountry } from "@/lib/auth/countries";
import { destinationAfterStep } from "@/lib/auth/country-step-destination";
import { COUNTRY_REQUIRED_MESSAGE, COUNTRY_SAVE_FAILED_MESSAGE, type CountryStepState } from "@/lib/auth/country-step-state";
import { submittedValues } from "@/lib/forms/keep-input";

/**
 * Continue on the Google country step. Saves the country in TWO places, deliberately: `profiles.country` (the data every other feature reads, and what Settings
 * and /admin/people/signups show) and the auth user's `user_metadata.country` (the flag the proxy gate reads without touching the database; see
 * src/lib/auth/google-country-gate.ts for why that flag is a data-quality gate and not a security gate). The session is then refreshed so the token the
 * browser holds carries the new metadata too; the proxy asks the auth server directly and sees it at once either way.
 *
 * NOTHING IS SAVED unless a listed country was chosen: an empty submit returns "Select a country to continue." and writes nothing. Only the sign-up list's
 * exact values are accepted, the same list the sign-up form uses.
 */
export async function saveGoogleCountryAction(_prev: CountryStepState, formData: FormData): Promise<CountryStepState> {
  const { user } = await requireUser();
  const typed = submittedValues(formData, ["country"]);
  const country = typed.country;

  if (!country || !isSignupCountry(country)) {
    return { status: "error", message: COUNTRY_REQUIRED_MESSAGE, values: typed };
  }

  const supabase = await createClient();
  const { error: profileError } = await supabase.from("profiles").update({ country }).eq("id", user.id);
  if (profileError) {
    console.error("[country-step] could not save profiles.country", profileError.message);
    return { status: "error", message: COUNTRY_SAVE_FAILED_MESSAGE, values: typed };
  }

  const { error: metadataError } = await supabase.auth.updateUser({ data: { country } });
  if (metadataError) {
    console.error("[country-step] could not save the country on the auth user", metadataError.message);
    return { status: "error", message: COUNTRY_SAVE_FAILED_MESSAGE, values: typed };
  }
  // Best effort: a failed refresh only means the browser's token carries the new metadata a little later; the gate does not read the token.
  await supabase.auth.refreshSession();

  redirect(destinationAfterStep(formData.get("next")));
}
