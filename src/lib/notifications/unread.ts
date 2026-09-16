import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Whether this user has any unread in-app notification (`user_notifications`,
 * 0131) — the real signal the Farah-visibility design review's notification
 * dot is wired to (farah-mark.tsx, farah-mobile-tab.tsx).
 *
 * AN EXISTENCE CHECK, same reasoning as `hasActivePass`
 * (src/lib/passes/entitlement.ts): the caller only ever needs "is there at
 * least one", never a count or the rows themselves.
 *
 * SERVICE-ROLE, NOT THE RLS-SCOPED SESSION CLIENT — this runs from
 * (app)/layout.tsx, a Server Component that only holds a user id
 * (`getOptionalUser` builds and discards its own session client internally,
 * never exposing it to the caller), not a live Supabase client of its own.
 * `.eq("user_id", userId)` is belt-and-braces regardless, same as
 * `hasActivePass`'s own comment on why: service_role bypasses RLS, so the
 * filter is what actually scopes this, not a policy.
 *
 * READ-ONLY, DELIBERATELY — this never marks anything read. That happens
 * exactly once, inside /api/farah/history's own handler, when FarahPanel's
 * client-side fetch resolves after mount. Two independent writers racing to
 * mark the same rows read was the failure shape to avoid; a second READER
 * carries no such risk — at worst this reports a row as unread a few hundred
 * milliseconds before the panel's own fetch clears it, which is exactly the
 * "accurate for the load that shows it" behaviour #420 already established.
 */
export async function hasUnreadNotification(userId: string): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { count, error } = await supabase
    .from("user_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) {
    // Fail closed: a broken check must not show a dot for something that
    // may not exist, and must not block the page — see this file's own
    // caller for why this is awaited alongside chrome that already tolerates
    // this shape of failure (getActivePass).
    console.error(`[notifications] could not check unread notifications for ${userId}: ${error.message}`);
    return false;
  }
  return (count ?? 0) > 0;
}
