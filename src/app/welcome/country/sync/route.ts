import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";
import { isSignupCountry } from "@/lib/auth/countries";
import { COUNTRY_STEP_PATH } from "@/lib/auth/google-country-gate";
import { destinationAfterStep } from "@/lib/auth/country-step-destination";

/**
 * For a Google account that ALREADY has a country on its profile (set in Settings, or before this step existed) but no country in its auth metadata, which is
 * what the proxy gate reads: copy the saved country into the metadata and carry on to where the person was going. They never see the form.
 *
 * A route handler, not the page, because only a route handler (or an action) can write the refreshed session cookies. Only ever the person's OWN profile country
 * is copied (nothing arrives from the request but the destination, which is a path on this site). If the profile has no listed country the person is sent to
 * the step instead.
 */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = new URL(request.url);
  const next = destinationAfterStep(searchParams.get("next"));
  const response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const { data: profile } = await supabase.from("profiles").select("country").eq("id", user.id).maybeSingle();
  const country = profile?.country ?? "";
  if (!isSignupCountry(country)) {
    return NextResponse.redirect(`${origin}${COUNTRY_STEP_PATH}?next=${encodeURIComponent(next)}`);
  }

  const { error } = await supabase.auth.updateUser({ data: { country } });
  if (error) return NextResponse.redirect(`${origin}${COUNTRY_STEP_PATH}?next=${encodeURIComponent(next)}`);
  await supabase.auth.refreshSession();
  return response;
}
