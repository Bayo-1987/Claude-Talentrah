import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectTo } from "@/lib/auth/redirect-to";
import { REFERRAL_COOKIE } from "@/lib/referrals/cookie";
import { EyebrowLabel } from "@/components/ui";
import { SignupForm } from "@/components/auth/signup-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { GoogleOneTap } from "@/components/auth/google-one-tap";

export const metadata = { title: "Create your account — Talentrah" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; redirectTo?: string }>;
}) {
  const { ref: queryRef, redirectTo: rawRedirectTo } = await searchParams;
  const redirectTo = safeRedirectTo(rawRedirectTo, "");

  /*
   * `?ref=` still wins when present — a fresh /signup?ref=CODE link (a
   * referrer sharing /refer's own link, unchanged) should always attribute
   * to the code IN the link it was clicked from, not to some earlier
   * first-touch cookie sitting from an unrelated visit. The cookie is only
   * the fallback for "arrived some other way and is signing up now" — a
   * scholarship share, or /signup reached with no code at all.
   */
  const ref = queryRef || (await cookies()).get(REFERRAL_COOKIE)?.value;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(redirectTo || "/dashboard");

  return (
    <div className="flex flex-col gap-8">
      {/* Renders nothing visible — see the component for why this page
          qualifies. A brand-new account still lands in /onboarding, same as
          signUpAction and signInWithOAuthAction below. */}
      <GoogleOneTap />
      <div className="flex flex-col gap-2">
        <EyebrowLabel>Create a free account</EyebrowLabel>
        <h2 className="font-display text-[28px]">Let&apos;s get you set up.</h2>
        <p className="text-[14.5px] text-ink-soft">
          Already have an account?{" "}
          <a
            href={redirectTo ? `/login?redirectTo=${encodeURIComponent(redirectTo)}` : "/login"}
            className="underline"
          >
            Log in
          </a>
          .
        </p>
      </div>

      <OAuthButtons />

      <div className="flex items-center gap-3 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-ink-soft">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <SignupForm referredByCode={ref} redirectTo={redirectTo || undefined} />
    </div>
  );
}
