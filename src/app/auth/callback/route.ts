import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";
import { DEFAULT_AFTER_AUTH_PATH, ONBOARDING_PATH, POST_AUTH_COOKIE, onboardingDestination, safeRedirectTo } from "@/lib/auth/redirect-to";

/**
 * Handles both OAuth redirects and email-confirmation links.
 *
 * THE SESSION COOKIES ARE WRITTEN ONTO THE RESPONSE THIS FUNCTION RETURNS (S1-44). It used to go through the shared `cookies()` store and
 * return a separate `NextResponse.redirect`, relying on Next to merge the two. That worked, but it was assumed rather than proven, and
 * it cannot be exercised outside a Next request scope. Building the redirect first and giving the Supabase client a cookie adapter that
 * writes straight onto it makes the claim testable (tests/auth/callback-cookies.test.ts) and independent of how Next merges.
 *
 * `next` comes from the query string, so it is only ever a path on this site (safeRedirectTo): `${origin}${next}` with "@evil.example"
 * or ".evil.example" would otherwise redirect off the site after a valid sign-in.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const queryNext = searchParams.get("next");
  const stashed = safeRedirectTo(request.cookies.get(POST_AUTH_COOKIE)?.value, "");
  // A sign-in or email-confirmation round trip that started on some page comes back through onboarding to THAT page (S1-50). Only the
  // ordinary entry (next=/onboarding) is given the stashed destination: a password-reset hop (next=/reset-password) is never redirected
  // by it. Without a `next` the visitor lands on the one default.
  const next = queryNext === ONBOARDING_PATH && stashed ? onboardingDestination(stashed) : safeRedirectTo(queryNext, DEFAULT_AFTER_AUTH_PATH);
  const clearStash = <T extends NextResponse>(res: T): T => {
    if (request.cookies.get(POST_AUTH_COOKIE)) res.cookies.set(POST_AUTH_COOKIE, "", { maxAge: 0, path: "/auth" });
    return res;
  };

  if (code) {
    const response = NextResponse.redirect(`${origin}${next}`);
    const supabase = createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    });
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return clearStash(response);
  }

  return clearStash(NextResponse.redirect(`${origin}/login?error=auth_callback_failed`));
}
