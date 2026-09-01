import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Is this feature switched on?
 *
 * The read side of the flag primitive, for the code a flag actually gates — a
 * cron, a route, a scheduled job. Deliberately tiny and deliberately not
 * cached: a flag is turned off because somebody wants it off NOW, and a cached
 * "true" is a feature that keeps running after the switch was thrown.
 *
 * FAILS CLOSED, on every path. An unknown key, a missing row, a database error
 * — all return false. A flag exists because somebody was unsure the feature
 * should run; the safe answer when we cannot tell is the one that does not
 * send anything to anyone. The column default is false for the same reason.
 */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    // Loud, because a flag that cannot be read is indistinguishable from one
    // that is off, and the difference matters when someone asks why the digest
    // did not go out.
    console.error("[feature-flags] could not read", key, error);
    return false;
  }
  return data?.enabled === true;
}
