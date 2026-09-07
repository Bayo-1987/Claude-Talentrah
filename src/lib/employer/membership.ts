import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/require-user";
import type { Tables } from "@/lib/supabase/types";

export interface EmployerContext {
  userId: string;
  userEmail: string | null;
  emailConfirmed: boolean;
  organization: Tables<"organizations">;
  role: string;
}

/**
 * Resolves the signed-in user's organisation, or sends them to onboarding.
 *
 * Reads membership through the user's OWN client, not the service role, so
 * the 0026 policy is what decides — if that policy ever regresses, every
 * employer page fails closed rather than quietly trusting a lookup that
 * bypassed it. The employer surface is the first product code to exercise
 * these policies at all, so it should lean on them, not around them.
 *
 * Phase 1 assumes one organisation per user. That is not enforced in the
 * schema (organization_members is keyed on org+user, so multiple rows are
 * possible) — it is simply the only shape the UI offers, and this picks the
 * earliest membership if that assumption is ever broken by direct DB access.
 */
export async function requireEmployer(): Promise<EmployerContext> {
  const context = await getEmployerContext();
  if (!context) redirect("/employer/onboarding");
  return context;
}

/** Same lookup without the redirect — for pages that handle "no org" themselves. */
export async function getEmployerContext(): Promise<EmployerContext | null> {
  const { user } = await requireUser();
  const supabase = await createClient();

  const { data: membership, error } = await supabase
    .from("organization_members")
    .select("role, created_at, organization_id, organizations(*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // A query error is not "no organisation". Treating it as one would bounce a
  // real employer to onboarding and invite them to create a duplicate org —
  // the same class of bug as applications/actions.ts's resume lookup.
  if (error) {
    throw new Error(`Couldn't load your organisation: ${error.message}`);
  }
  if (!membership?.organizations) return null;

  return {
    userId: user.id,
    userEmail: user.email ?? null,
    emailConfirmed: !!user.email_confirmed_at,
    organization: membership.organizations,
    role: membership.role,
  };
}

/**
 * Every organisation id the viewer belongs to — for the seeker feed, not the
 * employer surface.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM getEmployerContext ────────────────────
 *
 * Same table, same "an error is not an absence" rule, but three deliberate
 * differences, each one because the caller is /jobs — the hottest page in the
 * app, rendered for every seeker on every load, ~none of whom have an org:
 *
 *   1. NO `organizations(*)` JOIN. getEmployerContext fetches the whole org
 *      row because employer pages render it. The feed needs one uuid to build
 *      a filter with, and making every seeker pay for a joined row to learn
 *      "you have no organisation" is the wrong trade on this page.
 *   2. NO requireUser()/createClient(). The feed has both already; taking them
 *      as arguments keeps this one query, issuable inside the page's existing
 *      Promise.all rather than as a serial round trip before it.
 *   3. ALL memberships, not the earliest. getEmployerContext takes `limit(1)`
 *      because Phase 1 offers one org per user and it must pick one. This is
 *      matching against a database policy — `is_org_member` (0026) is true for
 *      ANY membership — so narrowing to the first would make the page disagree
 *      with RLS for a user with two, which the schema permits even though the
 *      UI never creates it.
 *
 * Read through the caller's OWN client, never the service role, for the reason
 * the file header gives: if 0026 ever regresses this fails closed.
 */
export async function getViewerOrganizationIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId);

  /*
   * A failure returns "no organisations", and that is the SAFE direction here
   * rather than the correct-looking one: this value only ever WIDENS what the
   * feed shows (an employer additionally sees their own unlisted postings), so
   * an empty answer degrades to exactly today's public behaviour. Throwing
   * would take the whole job feed down for every seeker over a lookup that
   * ~none of them need — the opposite trade from getEmployerContext, where the
   * same error means an employer is about to be told to create a second
   * organisation.
   */
  if (error) {
    console.error("[jobs] couldn't resolve viewer's organisations:", error.message);
    return [];
  }
  return (data ?? []).map((m) => m.organization_id);
}
