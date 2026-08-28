import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PATH_HEADER, safeRedirectTo } from "@/lib/auth/redirect-to";
import type { Tables } from "@/lib/supabase/types";

/**
 * Where to send someone back to, if we know.
 *
 * The path comes from the proxy's header (src/lib/supabase/middleware.ts) and
 * is still run through `safeRedirectTo` rather than trusted. It is our own
 * header, but a client can send one too — the proxy sets it, it does not strip
 * an incoming one — so treating it as trusted would be an open redirect with
 * extra steps.
 */
async function returnTripSuffix(): Promise<string> {
  const here = safeRedirectTo((await headers()).get(PATH_HEADER), "");
  return here ? `?redirectTo=${encodeURIComponent(here)}` : "";
}

/**
 * Redirects to /login if unauthenticated. Use at the top of protected pages.
 *
 * It now says where the person was. Before, every protected page sent a
 * signed-out visitor to a bare /login with no way back — so a shared link to
 * a job bounced them to a login form and then, on success, to the feed, having
 * silently dropped the thing they came for.
 */
export async function requireUser(): Promise<{
  user: NonNullable<Awaited<ReturnType<typeof getUser>>>;
  profile: Tables<"profiles">;
}> {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) redirect(`/login${await returnTripSuffix()}`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) redirect(`/login${await returnTripSuffix()}`);

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
