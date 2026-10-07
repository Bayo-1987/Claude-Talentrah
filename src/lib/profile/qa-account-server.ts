import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isQaAccount } from "@/lib/profile/qa-account";

/**
 * Whether the account with this id is a QA account (see qa-account.ts), for the writers that only hold a user id: product analytics (posthog.ts) and the
 * ad-event log (ads/promoted.ts).
 *
 * COST, because this runs for real users on Vercel Hobby: one indexed primary-key select of three columns (email, first_name, last_name) from `profiles`
 * per distinct user per 10 minutes per server instance, never on the request path (both callers run it after the response, inside `after()`). The verdict is
 * cached for 10 minutes; a QA verdict and a normal verdict are cached alike. The cache is bounded (it is cleared when it reaches 500 users) so it cannot grow
 * without limit on a long-lived instance.
 *
 * It FAILS OPEN: a read error, a missing profile row or a missing key returns false and is NOT cached, because dropping a real user's analytics or ad event
 * on a transient error is worse than recording a QA account's.
 */
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { qa: boolean; at: number }>();

export async function isQaUserId(userId: string): Promise<boolean> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.qa;
  try {
    const { data, error } = await createServiceRoleClient().from("profiles").select("email, first_name, last_name").eq("id", userId).maybeSingle();
    if (error || !data) return false;
    const qa = isQaAccount({ email: data.email, firstName: data.first_name, lastName: data.last_name });
    if (cache.size >= MAX_ENTRIES) cache.clear();
    cache.set(userId, { qa, at: Date.now() });
    return qa;
  } catch {
    return false;
  }
}
