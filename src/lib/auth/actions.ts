"use server";

import { redirect } from "next/navigation";
import { safeRedirectTo } from "./redirect-to";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  signUpSchema,
  signInSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "./schemas";

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
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
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
  const afterSignup = safeRedirectTo(formData.get("redirectTo"), "");
  redirect(afterSignup ? `/onboarding?next=${encodeURIComponent(afterSignup)}` : "/onboarding");
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

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "Incorrect email or password." };
  }

  /*
   * Back where they came from, or the feed. Validated here and not only at
   * the page that rendered the field: this reads a form value, and a form can
   * be posted by anything. `safeRedirectTo` refuses anything that could leave
   * the origin — see its comment for why the "//" case is the one that
   * matters.
   */
  redirect(safeRedirectTo(formData.get("redirectTo"), "/jobs"));
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

  redirect("/jobs");
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
    options: { redirectTo: `${origin}/auth/callback?next=/onboarding` },
  });

  if (error || !data.url) {
    redirect("/login?error=oauth_unavailable");
  }

  redirect(data.url);
}
