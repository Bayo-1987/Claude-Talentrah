import "server-only";
import { cookies } from "next/headers";
import {
  SIGNUP_PENDING_COOKIE,
  SIGNUP_PENDING_MAX_AGE_SECONDS,
  decodeSignupPending,
  encodeSignupPending,
  type SignupPending,
} from "./signup-pending-codec";

/**
 * Reads and writes the pending-signup cookie (S1-101): the address, the destination and the time the code went out, carried from the signup form to
 * /signup/check-email without the address ever being in a URL. See signup-pending-codec.ts for why it is a cookie and why it is not signed.
 * httpOnly (no script on the page can read it), sameSite lax, secure in production, scoped to /signup so it travels with nothing else.
 */
export async function setSignupPending(pending: SignupPending): Promise<void> {
  (await cookies()).set(SIGNUP_PENDING_COOKIE, encodeSignupPending(pending), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SIGNUP_PENDING_MAX_AGE_SECONDS,
    path: "/signup",
  });
}

export async function readSignupPending(): Promise<SignupPending | null> {
  return decodeSignupPending((await cookies()).get(SIGNUP_PENDING_COOKIE)?.value);
}

export async function clearSignupPending(): Promise<void> {
  (await cookies()).delete({ name: SIGNUP_PENDING_COOKIE, path: "/signup" });
}
