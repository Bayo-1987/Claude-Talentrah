"use server";

import { redirect } from "next/navigation";
import { safeRedirectTo } from "./redirect-to";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { signUpSchema, signInSchema } from "./schemas";

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
