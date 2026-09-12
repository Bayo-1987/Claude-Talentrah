"use server";

import { redirect } from "next/navigation";
import { onboardingDestination, ONBOARDING_PATH } from "./redirect-to";
import { headers, cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { REFERRAL_COOKIE } from "@/lib/referrals/cookie";
import {
  signUpSchema,
  signInSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  emailSchema,
} from "./schemas";
import { consumeResendRateLimit } from "./resend-rate-limit";
import { consumeLoginRateLimit } from "@/lib/security/login-rate-limit";
import { getRequestIp } from "@/lib/security/request-ip";
import type { ResendState } from "./resend-state";

export interface AuthActionState {
  error: string | null;
  fieldErrors?: Record<string, string[]>;
}

async function getOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

/** Shown for any resend failure that must not distinguish its cause — see below. */
const RESEND_GENERIC_ERROR = "Couldn't resend that — try again in a moment.";
/** Shown when either rate-limit bucket denies, or Supabase's own mailer throttle fires. */
const RESEND_RATE_LIMITED_ERROR =
  "That's a lot of requests for this address — try again later.";

export async function signUpAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signUpSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    country: formData.get("country"),
    password: formData.get("password"),
    termsAccepted: formData.get("termsAccepted"),
    referredByCode: formData.get("referredByCode") || undefined,
  });

  if (!parsed.success) {
    return {
      error: "Check the highlighted fields below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { firstName, lastName, email, country, password, referredByCode } =
    parsed.data;

  const supabase = await createClient();
  const origin = await getOrigin();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${ONBOARDING_PATH}`,
      data: {
        first_name: firstName,
        last_name: lastName,
        country,
        referred_by_code: referredByCode || null,
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  /*
   * The referral row is created by `handle_new_user` (0000, running as a
   * trigger on `auth.users`) the instant `signUp()` above succeeds — before
   * either redirect branch below, and regardless of whether email
   * confirmation means there's a session yet. So the cookie's job is done
   * here too, win or lose: a code that turned out to be a self-referral and
   * got nulled out by the trigger's own guard (0036) still shouldn't keep
   * re-offering itself on the visitor's next page view. Only clears a cookie
   * that was actually used — a `?ref=` from the query string with no cookie
   * set leaves nothing to clear, and that's fine.
   */
  if (referredByCode) {
    (await cookies()).delete(REFERRAL_COOKIE);
  }

  // If the Supabase project has "Confirm email" enabled, signUp() creates
  // the user but no session — per build-prompt §6.1's "browse before you
  // verify" decision (see plan doc M1), that setting should be OFF so users
  // land straight in onboarding; our own isEmailVerified() gate (see
  // src/lib/auth/require-user.ts) is what actually restricts sensitive
  // actions later. Handle both cases rather than assuming.
  if (!data.session) {
    redirect(`/signup/check-email?email=${encodeURIComponent(email)}`);
  }

  /*
   * A new account still goes through onboarding — that is not optional and a
   * redirectTo must not skip it. The destination is carried across instead, so
   * onboarding can hand them on at the end.
   */
  redirect(onboardingDestination(formData.get("redirectTo")));
}

/**
 * Resend the signup confirmation link, from /signup/check-email.
 *
 * REACHABLE WITH NO SESSION, on purpose — that page is reached before anyone
 * has one, and the whole point is giving a stuck visitor a second try without
 * asking them to start signup over. That is also exactly what makes it
 * different from every other rate-limited action in this codebase: the
 * caller isn't spending their own budget, they're triggering mail to
 * whatever address is in the `email` field, which may or may not be theirs.
 * See migration 0117 for the rate-limit table this calls into and why it
 * isn't `consumeRateLimit` (0038).
 *
 * SAME NON-COMMITTAL SHAPE AS `signUp()` ITSELF, and checked against the real
 * behavior rather than assumed: probed live against the CI project,
 * `supabase.auth.resend({ type: "signup", email })` returns NO error for
 * BOTH a nonexistent address and an already-confirmed one (GoTrue's own
 * anti-enumeration — there is nothing for this action to leak by branching
 * on those). It DID return an error for a genuinely unconfirmed real account
 * ("Email address ... is invalid", status 400) — which on inspection is not
 * about that account at all: it is Supabase's built-in mailer refusing to
 * send to an address outside the project's own team (the delivery
 * restriction that applies with no custom SMTP configured — see
 * docs/admin-auth.md). Left un-branched deliberately: whatever the true
 * cause, surfacing that specific message would tell a caller "this address
 * exists and has never been confirmed", which is exactly the fact this
 * screen must never reveal. Every non-rate-limit error below collapses to
 * the same generic sentence for that reason, not because the distinction
 * wasn't checked.
 */
export async function resendSignupConfirmationAction(
  email: string,
  _prevState: ResendState,
  _formData: FormData,
): Promise<ResendState> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return { status: "error", message: "That doesn't look like a valid email address." };
  }
  const validEmail = parsed.data;

  const ip = await getRequestIp();
  const limit = await consumeResendRateLimit(validEmail, ip);
  if (!limit.allowed) {
    return { status: "error", message: RESEND_RATE_LIMITED_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({ type: "signup", email: validEmail });

  if (error) {
    console.error("[resend-signup] failed:", error.message);
    if (error.status === 429) {
      return { status: "error", message: RESEND_RATE_LIMITED_ERROR };
    }
    return { status: "error", message: RESEND_GENERIC_ERROR };
  }

  return { status: "success", message: null };
}

export async function signInAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      error: "Enter a valid email and password.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  /*
   * Per-IP throttle BEFORE the real Supabase call — see login-rate-limit.ts's
   * own header for the gap this closes (Supabase's own auth rate limit is
   * shared across every login this server makes, not per attacker). Checked
   * ahead of signInWithPassword specifically so a caller already over their
   * own limit never reaches Supabase's endpoint at all.
   */
  const ip = await getRequestIp();
  const rateLimit = await consumeLoginRateLimit(ip, "seekerLogin");
  if (!rateLimit.allowed) {
    return { error: "Too many attempts — try again later." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "Incorrect email or password." };
  }

  /*
   * ONBOARDING, NOT THE FEED — and this line is the whole bug.
   *
   * This used to be `redirect(safeRedirectTo(formData.get("redirectTo"),
   * "/jobs"))`: straight to the feed, with no onboarding check of any kind.
   * Signup and the OAuth/One Tap callback both routed to `/onboarding`, so two
   * of the three entry points gated and this one did not.
   *
   * That gap is not theoretical. A confirmation link is single-use, so any
   * user whose first click does not cleanly land — Gmail prefetching the link
   * while it scans incoming mail, a second device, a closed tab — falls back
   * to this form. They then reach the app having never seen /onboarding and,
   * short of typing the URL, never can: signup and the callback are its only
   * other entrances. Confirmed on production, where one such account reached
   * /employer with zero rows in `resumes`.
   *
   * The destination is shared with the other entry points rather than
   * re-derived here, because a rule spelled out at four call sites is a rule
   * that drifts at one of them — which is how this bug was introduced.
   * `/onboarding` bounces anyone who does not need it.
   */
  redirect(onboardingDestination(formData.get("redirectTo")));
}

/**
 * Send a reset link. Says the same thing whether or not the account exists.
 *
 * ── THE ANTI-ENUMERATION RULE, AND WHY IT IS UNCONDITIONAL ────────────────
 *
 * This action NEVER branches on whether an account was found, and there is no
 * code path where it can. That is not caution about a hypothetical: a reset
 * form that answers differently for a registered address is an account
 * oracle — anyone can submit addresses and read off which ones are customers
 * of this product, which for a job-seeking product means learning who is
 * looking for work. The sign-in form already refuses to distinguish "no such
 * user" from "wrong password" for the same reason.
 *
 * Supabase's own `resetPasswordForEmail` does not leak it either — it resolves
 * the same way for an unknown address — so the only way to reintroduce the
 * leak is to add a lookup here on purpose. Do not.
 *
 * The `error` return is therefore reserved for things that are true regardless
 * of the address: a malformed email, or the mailer itself being down. Note
 * that even the second one is not reported to the user, only logged.
 */
export async function requestPasswordResetAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return {
      error: "Enter a valid email.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { email } = parsed.data;
  const supabase = await createClient();
  const origin = await getOrigin();

  /*
   * Same callback as signup confirmation and OAuth. /auth/callback exchanges
   * the code for a session and redirects to `next`, so the visitor arrives at
   * /reset-password already holding a recovery session — which is what makes
   * updateUser({ password }) below possible without asking for the old one.
   */
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  /*
   * Logged, not surfaced, and NOT allowed to change what the user sees. A
   * mailer outage is real and worth knowing about in logs, but telling this
   * visitor "we couldn't send it" while telling the next one "check your
   * email" is the same oracle by a different route — the failure would
   * correlate with something, and an attacker only needs a difference.
   */
  if (error) console.error("[password-reset] send failed:", error.message);

  redirect(`/forgot-password/check-email?email=${encodeURIComponent(email)}`);
}

/**
 * Resend the reset-password link, from /forgot-password/check-email.
 *
 * SAME SHAPE AS `resendSignupConfirmationAction`, and the same reason it
 * exists: reachable with no session, at a URL anyone can hit with any
 * address, so it is rate-limited by the same anonymous, text-keyed bucket
 * (migration 0117) rather than `consumeRateLimit`. Calls
 * `resetPasswordForEmail` with the SAME options `requestPasswordResetAction`
 * already uses, rather than re-deriving them, so the two never drift on
 * `redirectTo`.
 *
 * THE UNDERLYING ANTI-ENUMERATION RULE IS `requestPasswordResetAction`'s, not
 * a new one: `resetPasswordForEmail` already resolves the same way whether or
 * not the address is registered, and that action's own header explains why
 * that must never change. This action inherits it by calling the exact same
 * method the exact same way — it does not re-implement the guarantee, it
 * reuses it.
 */
export async function resendPasswordResetAction(
  email: string,
  _prevState: ResendState,
  _formData: FormData,
): Promise<ResendState> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return { status: "error", message: "That doesn't look like a valid email address." };
  }
  const validEmail = parsed.data;

  const ip = await getRequestIp();
  const limit = await consumeResendRateLimit(validEmail, ip);
  if (!limit.allowed) {
    return { status: "error", message: RESEND_RATE_LIMITED_ERROR };
  }

  const supabase = await createClient();
  const origin = await getOrigin();

  const { error } = await supabase.auth.resetPasswordForEmail(validEmail, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  if (error) {
    console.error("[resend-password-reset] send failed:", error.message);
    if (error.status === 429) {
      return { status: "error", message: RESEND_RATE_LIMITED_ERROR };
    }
    // Logged, not surfaced — same discipline as requestPasswordResetAction:
    // whether the address exists must never be observable from this response.
    return { status: "error", message: RESEND_GENERIC_ERROR };
  }

  return { status: "success", message: null };
}

/**
 * Set a new password using the recovery session the callback established.
 *
 * No current-password field, and that is not an omission: the proof of
 * identity is the emailed link, which is the whole point of a reset. Supabase
 * scopes the session to the user the link was minted for, so `updateUser` can
 * only ever change that account's password.
 *
 * The page renders nothing without a session, so reaching this action without
 * one means the session expired between load and submit. That returns an error
 * pointing back at the start rather than a silent no-op — `updateUser` on an
 * anonymous client would otherwise fail in a way the form has no vocabulary
 * for.
 */
export async function updatePasswordAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse({ password: formData.get("password") });

  if (!parsed.success) {
    return {
      error: "Check the highlighted field below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: "That reset link has expired. Request a new one to continue.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    /*
     * Surfaced rather than swallowed. Unlike the request step there is nothing
     * to enumerate here — the caller already holds a session for this
     * account — and the most likely cause is a rule Supabase enforces that
     * this form does not know about, which the user can act on.
     */
    return { error: error.message };
  }

  /*
   * AN OPERATOR LANDS AT THE ADMIN DOOR, not the job feed.
   *
   * This flow is the same one for everybody — deliberately, because a reset
   * form that behaved differently for an operator's address would be an
   * enumeration oracle (docs/admin-auth.md). That is about the REQUEST step,
   * where the caller is anonymous. Here the caller has already proved control
   * of the account, so choosing where to send them reveals nothing they do not
   * already know.
   *
   * It is a role check rather than a `redirectTo` parameter on purpose. A
   * parameter would have to be carried through the form, the emailed callback
   * and the reset page, and every one of those is a place an open redirect can
   * be introduced. There is no user-controlled value here at all, so that
   * question does not arise instead of being answered carefully four times.
   *
   * They still have to sign in again: this sends them to /admin/login, not
   * into /admin. The admin session is separate from the Supabase one by
   * design, and a recovery session is not an admin session.
   *
   * A disabled operator falls through to /jobs, which is correct — they cannot
   * use the admin door.
   */
  const service = createServiceRoleClient();
  const { data: operator } = await service
    .from("admin_users")
    .select("id")
    .eq("id", user.id)
    .is("disabled_at", null)
    .maybeSingle();

  /*
   * THE FOURTH ENTRY POINT, now routed like the other three.
   *
   * Completing a reset leaves the caller holding a live session, so this is a
   * post-authentication destination exactly like signup's, sign-in's and the
   * OAuth callback's — and it used to send everyone to `/jobs` unconditionally.
   * A resume-less account that recovered its password therefore skipped
   * onboarding in precisely the way `signInAction` used to allow, which is the
   * bug 0112 exists to close, in a fourth place.
   *
   * Found by e2e/forgot-password.spec.ts going red when sign-in started
   * gating, and deliberately left alone in that change as out of scope. It is
   * in scope now, and the rule it settles is the general one: every entry
   * point that hands someone a session asks the same question in the same
   * place, so this class of drift cannot recur by omission.
   *
   * NOT A REGRESSION FOR ANYONE WHO ALREADY BELONGS HERE. `/onboarding` bounces
   * a visitor who has a base resume or a skip marker, so an established user
   * still lands on `/jobs` exactly as before. The only accounts that now see
   * the upload screen are resume-less and never-skipped — the exact population
   * this whole class of bug stranded.
   *
   * THE OPERATOR BRANCH IS UNTOUCHED, and not by omission. An operator lands
   * at the admin door, still has to sign in there, and an admin session is
   * separate from the Supabase one by design (see the comment above).
   * `/onboarding` is a seeker screen with nothing to say to them.
   */
  redirect(operator ? "/admin/login" : onboardingDestination());
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Google/LinkedIn sign-in. Both providers are configured in the Supabase
 * dashboard (Authentication > Providers — client IDs/secrets and redirect
 * URLs live there, not in this app's env) — this call is provider-agnostic
 * on purpose, so enabling a new provider is a Supabase-side change only.
 */
export async function signInWithOAuthAction(formData: FormData) {
  const provider = formData.get("provider");
  if (provider !== "google" && provider !== "linkedin_oidc") {
    throw new Error("Unsupported OAuth provider");
  }

  const supabase = await createClient();
  const origin = await getOrigin();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${origin}/auth/callback?next=${ONBOARDING_PATH}` },
  });

  if (error || !data.url) {
    redirect("/login?error=oauth_unavailable");
  }

  redirect(data.url);
}
