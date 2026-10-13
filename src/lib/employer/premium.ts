import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/** Premium runs until a date an administrator set (0256); no date, or a date in the past, is not Premium. Pure, so the boundary can be tested. */
export function isPremiumUntil(premiumUntil: string | null | undefined, now: Date = new Date()): boolean {
  if (!premiumUntil) return false;
  const until = new Date(premiumUntil).getTime();
  return Number.isFinite(until) && until > now.getTime();
}

/**
 * Does this organisation have Premium right now? organization_premium (0256) has no grant and no policy for any API role, so only the service role can read it and a browser session can
 * neither see nor set it. This is the ACCESS gate only (Farah drafting on Message candidate); what Farah costs is charged to the ad wallet separately.
 */
export async function employerHasPremium(organizationId: string): Promise<boolean> {
  const { data, error } = await createServiceRoleClient().from("organization_premium").select("premium_until").eq("organization_id", organizationId).maybeSingle();
  // An unreadable value is "not Premium", never "Premium": fail closed.
  if (error || !data) return false;
  return isPremiumUntil(data.premium_until);
}
