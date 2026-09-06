/**
 * completeOneTapSignIn / oneTapSuccessDestination (src/lib/auth/one-tap-client.ts).
 *
 * This is the half of the One Tap nonce story that a live Google ID token
 * can't be forged for in this sandbox (Supabase's GoTrue verifies the token
 * against Google's real signing keys, which nothing here can produce a valid
 * signature for). What CAN be pinned without one, and is the actual bug
 * class this review cares about: that our own code
 *   (a) hands Supabase the RAW nonce, never the hashed one Google got, and
 *   (b) treats an `error` from signInWithIdToken as a rejection — never as
 *       "resolved without throwing, so it must be fine" — and, critically,
 *   (c) never navigates a visitor into a signed-in destination on that
 *       rejection.
 * A Supabase client that rejects a mismatched/tampered nonce is only a real
 * defense if the caller actually listens to the answer; these tests are
 * about the caller.
 */
import { describe, expect, it, vi } from "vitest";
import type {
  AuthError,
  AuthTokenResponse,
  Session,
  SignInWithIdTokenCredentials,
  User,
} from "@supabase/supabase-js";
import {
  completeOneTapSignIn,
  oneTapSuccessDestination,
  type OneTapAuthClient,
} from "@/lib/auth/one-tap-client";

const CREDENTIAL = "header.payload.signature";
const RAW_NONCE = "the-raw-nonce-supabase-should-receive";
const HASHED_NONCE = "the-hashed-nonce-that-must-never-reach-supabase";

type SignInMock = ReturnType<
  typeof vi.fn<(credentials: SignInWithIdTokenCredentials) => Promise<AuthTokenResponse>>
>;

function fakeSupabase(signInWithIdToken: SignInMock): OneTapAuthClient {
  return { auth: { signInWithIdToken } };
}

function fakeUser(): User {
  return {
    id: "u1",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: new Date().toISOString(),
  } as User;
}

function fakeSession(): Session {
  return {
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_in: 3600,
    token_type: "bearer",
    user: fakeUser(),
  } as Session;
}

/** A successful GoTrue response — a real session and user, no error. */
function successResponse(): AuthTokenResponse {
  return { data: { session: fakeSession(), user: fakeUser() }, error: null } as AuthTokenResponse;
}

/**
 * A REJECTED response — the exact shape @supabase/supabase-js returns for a
 * mismatched/tampered nonce or any other sign-in-with-id-token failure. It
 * resolves (never throws); `error` is set and `data.session`/`data.user` are
 * null. `message` defaults to text a real nonce-mismatch error carries.
 */
function rejectedResponse(message = "Passed nonce does not match nonce in id_token"): AuthTokenResponse {
  return {
    data: { session: null, user: null },
    error: { message, code: "invalid_credentials", status: 400, name: "AuthApiError" } as AuthError,
  } as AuthTokenResponse;
}

function mockSignIn(response: AuthTokenResponse): SignInMock {
  return vi
    .fn<(credentials: SignInWithIdTokenCredentials) => Promise<AuthTokenResponse>>()
    .mockResolvedValue(response);
}

describe("completeOneTapSignIn", () => {
  it("calls signInWithIdToken with the RAW nonce, not the hashed one — the crux of the whole nonce flow", async () => {
    const signInWithIdToken = mockSignIn(successResponse());

    await completeOneTapSignIn(fakeSupabase(signInWithIdToken), CREDENTIAL, RAW_NONCE);

    expect(signInWithIdToken).toHaveBeenCalledTimes(1);
    expect(signInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token: CREDENTIAL,
      nonce: RAW_NONCE,
    });
    // Guards against a regression that swaps in the hashed value instead.
    const call = signInWithIdToken.mock.calls[0][0];
    expect((call as { nonce: string }).nonce).not.toBe(HASHED_NONCE);
  });

  it("a genuine sign-in (session returned, no error) resolves ok: true", async () => {
    const signInWithIdToken = mockSignIn(successResponse());

    const result = await completeOneTapSignIn(fakeSupabase(signInWithIdToken), CREDENTIAL, RAW_NONCE);
    expect(result).toEqual({ ok: true });
  });

  it("SABOTAGE-PROOF TARGET: a nonce mismatch rejected by Supabase (error, no session) is surfaced as failure, not silently accepted", async () => {
    // This is exactly the shape @supabase/supabase-js returns for a rejected
    // signInWithIdToken call — it resolves, it does not throw, and the only
    // signal is `error` being set with `data.session` null.
    const signInWithIdToken = mockSignIn(rejectedResponse());

    const result = await completeOneTapSignIn(
      fakeSupabase(signInWithIdToken),
      CREDENTIAL,
      "a-tampered-nonce",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/nonce/i);
    }
  });

  it("a resolved-but-sessionless response (no explicit error object either) still counts as failure, never success", async () => {
    // Defends against trusting "no error thrown" as proof of a session — the
    // exact mistake this file's header warns about.
    const signInWithIdToken = mockSignIn({
      data: { session: null, user: null },
      error: null,
    } as unknown as AuthTokenResponse);

    const result = await completeOneTapSignIn(fakeSupabase(signInWithIdToken), CREDENTIAL, RAW_NONCE);
    expect(result.ok).toBe(false);
  });

  it("SABOTAGE-PROOF TARGET: the caller-side gate — a failed result must never trigger the onboarding redirect", async () => {
    const signInWithIdToken = mockSignIn(rejectedResponse());

    const navigate = vi.fn();
    const result = await completeOneTapSignIn(
      fakeSupabase(signInWithIdToken),
      CREDENTIAL,
      "a-tampered-nonce",
    );

    // Mirrors exactly the branch in google-one-tap.tsx's callback: only
    // navigate when the result is ok.
    if (result.ok) navigate(oneTapSuccessDestination());

    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("oneTapSuccessDestination", () => {
  it("is unconditionally /onboarding — same destination for a brand-new account and a returning one", () => {
    expect(oneTapSuccessDestination()).toBe("/onboarding");
  });
});
