import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getOptionalUser } from "@/lib/auth/require-user";
import { needsGoogleCountryStep, COUNTRY_STEP_PATH } from "@/lib/auth/google-country-gate";
import { destinationAfterStep } from "@/lib/auth/country-step-destination";
import { countryFromAcceptLanguage } from "@/lib/auth/country-from-locale";
import { isSignupCountry } from "@/lib/auth/countries";
import { EyebrowLabel } from "@/components/ui";
import { CountryStepForm } from "@/components/auth/country-step-form";

export const metadata: Metadata = { title: "One last step — Talentrah", robots: { index: false, follow: false } };

/**
 * The Google country step (owner, 9 Oct): "Where are you based?", once, for a person who signed up with Google and has no country. The proxy sends them here from
 * any seeker-app page (src/lib/auth/google-country-gate.ts); this page decides what to show:
 *  - signed out: to /login;
 *  - nobody who needs it (email sign-up, or a country is already on record): straight on to where they were going;
 *  - a Google account whose PROFILE already has a country (set in Settings, or before this step existed): the sync route copies it to the account and carries on, so they never see the form;
 *  - otherwise the form, with the country the browser's locale suggests, if it maps to a listed one.
 */
export default async function CountryStepPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const next = destinationAfterStep(params.next);
  const session = await getOptionalUser();
  if (!session) redirect(`/login?redirectTo=${encodeURIComponent(`${COUNTRY_STEP_PATH}?next=${next}`)}`);

  const { user, profile } = session;
  if (!needsGoogleCountryStep(user)) redirect(next);
  if (profile.country && isSignupCountry(profile.country)) redirect(`${COUNTRY_STEP_PATH}/sync?next=${encodeURIComponent(next)}`);

  const suggested = countryFromAcceptLanguage((await headers()).get("accept-language"));
  const meta = user.user_metadata as { given_name?: string; full_name?: string; name?: string };
  const firstName = profile.first_name?.trim() || meta.given_name?.trim() || (meta.full_name ?? meta.name ?? "").trim().split(/\s+/)[0] || "";

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="border-b-2 border-ink px-6 py-4">
        <Link href="/" prefetch={false} className="inline-flex items-center no-underline">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG, same as the auth layout */}
          <img src="/talentrah-horizontal.svg" alt="Talentrah" width={320} height={80} className="h-7 w-auto" />
        </Link>
      </header>
      <main id="main-content" className="flex flex-1 justify-center px-6 py-10">
        <div className="flex w-full max-w-[440px] flex-col gap-6">
          <div className="flex flex-col gap-3">
            <EyebrowLabel>One last step</EyebrowLabel>
            <h1 className="font-display text-[34px] font-medium leading-[1.1] text-ink">Where are you based?</h1>
            <p className="text-[16px] leading-[1.55] text-ink-soft">
              {firstName ? `Welcome, ${firstName}. ` : "Welcome. "}We use your country to show jobs, salaries and scholarships that fit where you live.
            </p>
          </div>
          <CountryStepForm suggested={suggested} next={next} />
          <p className="text-[14px] text-ink-soft">You can change this later in Settings.</p>
        </div>
      </main>
    </div>
  );
}
