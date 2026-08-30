import "server-only";
import { createClient as createStandaloneClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * TOTP for operator accounts.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * An admin's credential IS a seeker credential — 0060 isolates the
 * authorisation in `admin_users`, deliberately not the credential — so once
 * the seeker forgot-password flow shipped, anyone holding an operator's email
 * inbox could reset that password and sign in at /admin/login. Excluding
 * operators from reset would be worse (an enumeration oracle, and no recovery
 * for a locked-out operator), so the fix is a second factor.
 *
 * IT ACTUALLY CLOSES THE HOLE, and that was measured against the live API
 * before any of this was written rather than taken from documentation:
 *
 *     after enrolling and verifying     AAL: aal2
 *     fresh password-only login         AAL: aal1   <- what the attacker has
 *     mfa.unenroll from that session    422 AAL2 required to unenroll verified factor
 *
 * If that last call had succeeded, the whole mitigation would have been one
 * request from bypassable: reset the password, remove the factor, walk in.
 *
 * ── SUPABASE'S TOTP, NOT OURS ────────────────────────────────────────────
 *
 * Rolling our own would mean storing a shared secret we control and
 * hand-rolling verification — drift windows, replay rejection, all of it. The
 * standing position in this repo is that our own security code is the likelier
 * source of a real vulnerability, which is exactly why M1 kept Supabase Auth as
 * the credential store rather than building one.
 *
 * Email OTP was rejected outright rather than compared: the threat IS inbox
 * compromise, so an email second factor protects against approximately nothing
 * here.
 *
 * ── WHY EVERY CALL TAKES A PASSWORD ──────────────────────────────────────
 *
 * The MFA API operates on a Supabase SESSION, and /admin/login deliberately
 * throws its session away — nothing about being signed in to the admin
 * dashboard is backed by a Supabase session, which is the property that makes
 * a stolen `sb-*` cookie useless at /admin.
 *
 * Server Actions are stateless, so a two-step enrolment would have to carry an
 * access token between requests, in a cookie. That is a new credential at rest
 * on exactly the surface M1 exists to keep credential-free. Re-authenticating
 * with the password instead costs the operator one extra password entry during
 * a one-time setup and stores nothing at all.
 */

function ephemeral() {
  // Persists nothing: the session exists for the length of one call and is
  // never written to a cookie, a header, or this app's storage.
  return createStandaloneClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

export interface EnrolmentStart {
  factorId: string;
  /** The base32 secret, for an authenticator app that cannot scan. */
  secret: string;
  /** otpauth:// URI — rendered as a QR code by the page. */
  uri: string;
}

/**
 * Begin enrolment: create an UNVERIFIED factor and hand back what the operator
 * needs to add it to their authenticator.
 *
 * The factor is useless until `completeEnrolment` verifies it, so an abandoned
 * enrolment leaves an inert row rather than a half-locked account.
 */
export async function beginEnrolment(
  email: string,
  password: string,
): Promise<EnrolmentStart | { error: string }> {
  const supabase = ephemeral();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) return { error: "Incorrect password." };

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error) {
    // The common one: a verified factor already exists. Say so plainly — the
    // operator is authenticated at this point, so there is nothing to protect
    // by being vague.
    console.error("[admin-mfa] enroll", error);
    return { error: error.message };
  }

  return { factorId: data.id, secret: data.totp.secret, uri: data.totp.uri };
}

/**
 * Finish enrolment by proving the operator can produce a code.
 *
 * Requires the password again because the factor from `beginEnrolment` belongs
 * to a session that no longer exists — see the note above on why nothing is
 * carried between the two steps.
 */
export async function completeEnrolment(
  email: string,
  password: string,
  factorId: string,
  code: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = ephemeral();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) return { error: "Incorrect password." };

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: "That code was not accepted. Check your device's clock and try again." };

  return { ok: true };
}

/**
 * Verify a code during login, for an operator who is already enrolled.
 *
 * Returns true only if the session actually reached aal2 — asserted rather
 * than inferred from the absence of an error, because "no error" and "the
 * factor was satisfied" are different claims and only one of them is the gate.
 */
export async function verifyLoginCode(
  email: string,
  password: string,
  code: string,
): Promise<boolean> {
  const supabase = ephemeral();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) return false;

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) {
    console.error("[admin-mfa] listFactors", listError);
    return false;
  }
  const totp = factors.totp?.[0];
  if (!totp) return false;

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
  if (error) return false;

  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return level?.currentLevel === "aal2";
}
