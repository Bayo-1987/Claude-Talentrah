import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PATH_HEADER, safeRedirectTo } from "@/lib/auth/redirect-to";
import type { User } from "@supabase/supabase-js";
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

export interface Session {
  user: User;
  profile: Tables<"profiles">;
}

/*
 * ── WHY THESE ARE WRAPPED IN `cache()` ──────────────────────────────────
 *
 * `supabase.auth.getUser()` is an HTTP request to the auth server, not a
 * local JWT decode — it costs a real round trip every time it is called.
 * Rendering one authenticated page called it THREE times: once in the proxy
 * (src/lib/supabase/middleware.ts), once in (app)/layout.tsx via
 * `getOptionalUser`, and once in the page itself via `requireUser`. The
 * layout and the page then each ran their own identical
 * `profiles.select("*")` on top of that.
 *
 * React's `cache()` memoizes per SERVER REQUEST — the entry is created when
 * the request starts rendering and discarded when it finishes, so two users
 * can never see each other's result and a value cannot go stale between
 * requests. That makes it the right tool for "this request already asked
 * the auth server who this is".
 *
 * WHAT IT DOES NOT COLLAPSE, and this is worth stating because it is the
 * obvious wrong assumption: the PROXY's `getUser()` still happens. Proxy
 * middleware is a separate function invocation from the render, so no
 * per-request cache can span the two, and that call is load-bearing anyway
 * — it is what refreshes an expiring session cookie. So an authenticated
 * page goes from three auth round trips to two, and from two profile
 * queries to one. Not to one and zero.
 *
 * MEMOIZATION ONLY WORKS IF THE ARGUMENTS MATCH. That is why the auth read
 * below takes no arguments at all, rather than the Supabase client it used
 * to take: `createClient()` builds a new object per call, so a
 * `cache()`-wrapped function keyed on that client would miss every single
 * time and quietly do nothing. The client is created inside instead.
 */

/**
 * The signed-in auth user, or null. One auth-server round trip per request,
 * however many callers ask.
 */
const currentAuthUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * The caller's own profile row. Keyed on the user id, so the layout and the
 * page share one query — see the note above on argument matching.
 *
 * `maybeSingle`, not `single`: zero rows is a state both callers below
 * handle explicitly, and `single` turns it into a PGRST116 error object for
 * no benefit. Behaviour is unchanged either way — both produce `null` data.
 */
const profileFor = cache(async (userId: string): Promise<Tables<"profiles"> | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  return data ?? null;
});

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
 *
 * That distinction is about CALLERS and is unchanged by `requireUser` now
 * being implemented in terms of this function. Sharing the reads is not the
 * same as sharing the contract: this one returns null, that one redirects,
 * and which of those a page wants is still a decision the page has to make.
 */
export const getOptionalUser = cache(async (): Promise<Session | null> => {
  const user = await currentAuthUser();
  if (!user) return null;

  const profile = await profileFor(user.id);

  // A session without a profile row is the same broken state `requireUser`
  // redirects on; here it degrades to "signed out" rather than bouncing a
  // reader off a page they are allowed to read.
  return profile ? { user, profile } : null;
});

/**
 * Redirects to /login if unauthenticated. Use at the top of protected pages.
 *
 * It now says where the person was. Before, every protected page sent a
 * signed-out visitor to a bare /login with no way back — so a shared link to
 * a job bounced them to a login form and then, on success, to the feed, having
 * silently dropped the thing they came for.
 *
 * NOT ITSELF `cache()`-WRAPPED, on purpose. Its two reads already are, so
 * calling it twice in a request costs nothing extra — and wrapping a
 * function whose failure path is `redirect()` would memoize a thrown
 * control-flow signal, which works today but is a strange thing to rely on.
 * The cache belongs on the data, not on the guard.
 */
export async function requireUser(): Promise<Session> {
  const session = await getOptionalUser();
  // Both the no-user and the no-profile case land here, exactly as before:
  // a session whose profile row is missing is not a usable session.
  if (!session) redirect(`/login${await returnTripSuffix()}`);
  return session;
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
