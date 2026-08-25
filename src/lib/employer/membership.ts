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
