import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SALARY_CURRENCY, defaultSalaryCurrency, type SalaryCurrency } from "./salary-input";

/**
 * The currency to preselect on the post-a-job / edit-a-job form.
 *
 * `organizations` has no country column — an organisation is a name, a domain
 * and a verification state — so the closest stored fact about where an
 * employer is based is the signed-in member's own `profiles.country` (picked
 * at signup: Nigeria, Ghana, Kenya, South Africa, United Kingdom, United
 * States, Canada, or "Other"). That is what this reads. "Other", an unmapped
 * country, a missing profile row or a failed read all fall back to NGN, the
 * product's home market: a wrong default costs one click, and a failed lookup
 * must never block posting a job.
 */
export async function getDefaultSalaryCurrency(userId: string): Promise<SalaryCurrency> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("profiles").select("country").eq("id", userId).maybeSingle();
    return defaultSalaryCurrency(data?.country);
  } catch {
    return DEFAULT_SALARY_CURRENCY;
  }
}
