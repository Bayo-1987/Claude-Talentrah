import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { carryCookies } from "@/lib/supabase/carry-cookies";
import { PENDING_DELETION_PATH } from "@/lib/auth/pending-deletion-path";
import { isEmployerPath, safeRedirectTo } from "@/lib/auth/redirect-to";
import { isProtectedSeekerPath } from "@/lib/auth/seeker-gate-paths";

/**
 * The Google country step: one required "Where are you based?" screen after a FIRST Google sign-in (button or One Tap), because Google gives us a name and
 * an email and no country, so those accounts showed "—" in /admin/people/signups and had no country for jobs, salaries and scholarships to fit.
 *
 * DATA-QUALITY GATE, NOT A SECURITY GATE. The flag it reads is `user_metadata.country`, and a person can write their own user_metadata (that is how the
 * email sign-up form carries the country it collects). Someone who sets it by hand only skips a form that exists to ask them a question; nothing is protected
 * by the step and nothing breaks if it is skipped (the country stays empty, as it is today). Authority over what the country IS stays with `profiles.country`.
 *
 * NO DATABASE READ HERE. The proxy already holds the user from `auth.getUser()` (a live call to the auth server on every request, so a value saved a moment ago
 * is seen at once, with no wait for the access token to be reissued). Same cost model as the pending-deletion gate.
 *
 * WHO IS GATED: a signed-in user whose account was CREATED with Google (`app_metadata.provider === "google"`) and who has no country in `user_metadata`. NOT
 * "country is empty" alone: the pooled test users and minted e2e sessions are email users with a null country, and must reach the dashboard (tests pin it).
 * Email sign-ups collect a country in the form, so they never qualify, and an email user who later links Google keeps `provider: "email"` and is not asked.
 * An existing Google user whose profile already has a country but whose metadata does not is passed through by the step page itself (it copies the saved
 * country into the metadata and moves on): they never see the form.
 *
 * WHERE: the seeker app's protected paths (the same list the signed-out gate uses) AND the signed-in seeker pages that are public for a signed-out visitor: /jobs (the
 * default landing after sign-in), /tracker, /scholarships, /mentorship, /refer. A returning Google user with no country must be asked wherever they land (QA GOOGLE-COUNTRY-1).
 * That widening is safe because the gate acts ONLY on a signed-in provider=google user with no country: a signed-out visitor or crawler has no user and is never touched, so those
 * public pages and their SEO are unaffected (tests pin it), and /blog, /about and the legal pages are not on the list. Employer and admin paths are NOT gated, on purpose: this
 * is a seeker onboarding question, and an employer who signed in with Google is answering for an organisation. Everything else is exempt so there is never a loop: the
 * step itself, /auth (callback, sign-out), the API, /login, the deletion-pending path and its confirm page, /admin, static assets.
 */
export const COUNTRY_STEP_PATH = "/welcome/country";

const EXEMPT = [COUNTRY_STEP_PATH, "/auth", "/api", "/login", PENDING_DELETION_PATH, "/settings/delete-account/confirm", "/admin", "/_next"];
const HAS_FILE_EXTENSION = /\.[a-z0-9]{2,8}$/i;

/** Pages a signed-in seeker lands on that are ALSO public pages for a signed-out visitor, so they are not on the signed-out gate's protected list. Bare path and everything beneath it. */
const SIGNED_IN_SEEKER_PREFIXES = ["/jobs", "/tracker", "/scholarships", "/mentorship", "/refer"];

/** True for a page this gate may redirect from: a protected seeker path, or one of the signed-in seeker landing pages. */
export function isCountryGatedPath(pathname: string): boolean {
  return isProtectedSeekerPath(pathname) || SIGNED_IN_SEEKER_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** True for a user who signed up with Google and has no country recorded in their metadata. */
export function needsGoogleCountryStep(user: Pick<User, "app_metadata" | "user_metadata">): boolean {
  if (user.app_metadata?.provider !== "google") return false;
  const country = user.user_metadata?.country;
  return !(typeof country === "string" && country.trim() !== "");
}

export function isCountryStepExempt(pathname: string): boolean {
  if (HAS_FILE_EXTENSION.test(pathname)) return true;
  if (isEmployerPath(pathname)) return true;
  return EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function googleCountryGate(request: NextRequest, response: NextResponse, user: User | null): NextResponse | null {
  if (!user || !needsGoogleCountryStep(user)) return null;
  const { pathname, search } = request.nextUrl;
  if (isCountryStepExempt(pathname)) return null;
  if (!isCountryGatedPath(pathname)) return null;

  const url = request.nextUrl.clone();
  url.pathname = COUNTRY_STEP_PATH;
  url.search = "";
  // The destination travels with the step (same site only), so a job deep link survives it.
  url.searchParams.set("next", safeRedirectTo(pathname + search, "/dashboard"));
  // The refreshed session cookies go with the redirect, as in the other proxy gates (src/lib/supabase/carry-cookies.ts).
  return carryCookies(response, NextResponse.redirect(url));
}
