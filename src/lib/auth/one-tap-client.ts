import type { AuthTokenResponse, SignInWithIdTokenCredentials } from "@supabase/supabase-js";
import { onboardingDestination } from "./redirect-to";

/**
 * The one method this module actually calls, typed structurally rather than
 * as `Pick<SupabaseClient<Database>, "auth">` — the full generated
 * `SupabaseClient<Database>` generic makes a plain `{ auth: { signInWithIdToken: vi.fn() } }`
 * test double fight TypeScript for no real safety benefit; this is the exact
 * shape both the real browser client and a test mock need to satisfy.
 */
export interface OneTapAuthClient {
  auth: {
    signInWithIdToken(credentials: SignInWithIdTokenCredentials): Promise<AuthTokenResponse>;
  };
}

/**
 * Redeems a Google One Tap credential for a Supabase session, and only that
 * — it does not navigate anywhere. Kept separate from the React component so
 * the nonce plumbing can be unit-tested without a DOM: see
 * tests/auth/one-tap-client.test.ts, which is what actually pins the raw vs.
 * hashed nonce distinction documented in one-tap-nonce.ts.
 *
 * `nonce` here MUST be the raw value from `getOneTapNonceAction`, never the
 * hashed one handed to Google's script — passing the hash here would make
 * `signInWithIdToken` hash it a second time, produce a value that can never
 * match the ID token's `nonce` claim, and reject every sign-in. Passing
 * nothing at all would silently skip the replay check entirely, which is the
 * failure mode that actually matters: a captured ID token from an unrelated
 * challenge would be accepted. Both are why this takes `nonce` as a required
 * parameter rather than an optional one with a "just don't bother" default.
 *
 * Returns a plain result object rather than throwing: `signInWithIdToken`
 * itself never throws for a rejected/mismatched token, it resolves with
 * `error` set (see @supabase/supabase-js) — this wrapper preserves that
 * shape so a caller can't accidentally treat "resolved without throwing" as
 * "signed in".
 */
export type OneTapSignInResult = { ok: true } | { ok: false; error: string };

export async function completeOneTapSignIn(
  supabase: OneTapAuthClient,
  credential: string,
  nonce: string,
): Promise<OneTapSignInResult> {
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: credential,
    nonce,
  });

  if (error || !data.session) {
    return { ok: false, error: error?.message ?? "No session returned." };
  }

  return { ok: true };
}

/**
 * The one and only place this feature decides where to send someone —
 * ALWAYS `/onboarding`, on ANY successful sign-in, new account or returning
 * one alike. This is not a heuristic guessing which case applies: it's the
 * same unconditional destination `signUpAction` and `signInWithOAuthAction`
 * already use (src/lib/auth/actions.ts), and it works for both cases for the
 * same reason it works there — `/onboarding` itself redirects a user who
 * already has a base resume straight on to `/jobs` (or `next`), so "did this
 * account just get created" is a question this code never has to answer.
 * Getting that wrong here — e.g. sending a One Tap sign-in straight to
 * `/jobs` — would let a brand-new account skip the resume upload the rest of
 * the product assumes every account has been through.
 *
 * A failed/rejected sign-in (nonce mismatch, expired credential, network
 * error) must NOT call this — the caller only invokes it when
 * `completeOneTapSignIn` returned `{ ok: true }`.
 */
export function oneTapSuccessDestination(): string {
  // Shared with signUpAction, signInAction and the OAuth callback (0112), so
  // a fourth entry point cannot quietly disagree the way signInAction did.
  return onboardingDestination();
}
