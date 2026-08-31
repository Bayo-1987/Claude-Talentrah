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

/**
 * The signed-in user and profile, or null — never redirects.
 *
 * For the one surface that must render for a signed-out visitor AND a crawler:
 * the public job detail page. `requireUser` cannot serve it, because a 302 to
 * /login is exactly what stopped Googlebot from ever seeing a posting.
 *
 * DELIBERATELY NOT A DROP-IN FOR `requireUser`. Every other page under (app)
 * calls `requireUser` itself and must keep doing so — verified across all 14 of
 * them before the layout's own gate was relaxed. This exists so a page can opt
 * IN to being public, not so pages can forget to opt out.
 */
export async function getOptionalUser(): Promise<{
  user: NonNullable<Awaited<ReturnType<typeof getUser>>>;
  profile: Tables<"profiles">;
} | null> {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  // A session without a profile row is the same broken state `requireUser`
  // redirects on; here it degrades to "signed out" rather than bouncing a
  // reader off a page they are allowed to read.
  return profile ? { user, profile } : null;
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
