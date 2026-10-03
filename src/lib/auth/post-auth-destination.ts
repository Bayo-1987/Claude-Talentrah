import "server-only";
import { cookies } from "next/headers";
import { POST_AUTH_COOKIE, POST_AUTH_COOKIE_MAX_AGE_SECONDS, safeRedirectTo } from "./redirect-to";

/**
 * Remembers where a visitor was headed across a round trip that leaves the site (Google, LinkedIn, an emailed confirmation link), for
 * /auth/callback to pick up (S1-50). A valid same-site destination is stored; anything else (nothing, or an attempt at an open redirect)
 * stores nothing and removes whatever an earlier attempt left, so a stale destination never follows someone into a later sign-in.
 */
export async function stashPostAuthDestination(rawRedirectTo: unknown): Promise<void> {
  const jar = await cookies();
  const destination = safeRedirectTo(rawRedirectTo, "");
  if (!destination) {
    jar.delete({ name: POST_AUTH_COOKIE, path: "/auth" });
    return;
  }
  jar.set(POST_AUTH_COOKIE, destination, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: POST_AUTH_COOKIE_MAX_AGE_SECONDS,
    path: "/auth",
  });
}
