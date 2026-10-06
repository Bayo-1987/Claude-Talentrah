import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface CacDetails {
  cacNumber: string | null;
  cacBusinessName: string | null;
}

/**
 * An organisation's company-registration details, read with the service role for ONE organisation.
 *
 * Migration 0232 withholds `cac_number` and `cac_business_name` from the signed-in role (they identify an employer's registered company and were readable by
 * anyone holding the public key), so the employer's own profile page can no longer read them through its own session. The CALLER must have established that
 * the viewer belongs to `organizationId` first: the profile page does, by taking the id from `requireEmployer()`, whose lookup runs as the user under row
 * security. This function takes an id and trusts it, and is deliberately not exported through anything a browser can call (it is not a Server Action).
 */
export async function loadOrganizationCacDetails(organizationId: string): Promise<CacDetails> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("cac_number, cac_business_name")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error(`Couldn't load your company registration details: ${error.message}`);
  return { cacNumber: data?.cac_number ?? null, cacBusinessName: data?.cac_business_name ?? null };
}
