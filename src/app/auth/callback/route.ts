import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";
import { safeRedirectTo } from "@/lib/auth/redirect-to";

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
  const next = safeRedirectTo(searchParams.get("next"), "/dashboard");

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
    if (!error) return response;
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
