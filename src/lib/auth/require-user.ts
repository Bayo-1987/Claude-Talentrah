import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/types";

/** Redirects to /login if unauthenticated. Use at the top of protected pages. */
export async function requireUser(): Promise<{
  user: NonNullable<Awaited<ReturnType<typeof getUser>>>;
  profile: Tables<"profiles">;
}> {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");

  return { user, profile };
}

async function getUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Guard for actions that require a verified email — first tailoring run,
 * applying, etc. (build-prompt §6.1: browsing stays open pre-verification,
 * these do not). Later milestones call this before the action runs.
 */
export function isEmailVerified(
  user: { email_confirmed_at?: string | null } | null,
): boolean {
  return !!user?.email_confirmed_at;
}
