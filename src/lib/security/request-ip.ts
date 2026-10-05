import "server-only";
import { headers } from "next/headers";

/**
 * The caller's IP, from `x-forwarded-for`'s first entry (the original
 * client, per the standard's left-to-right proxy-chain convention) — the
 * same extraction `src/lib/auth/actions.ts` already used privately for the
 * resend-rate-limit path (0117), pulled out here so the login rate limiter
 * (and any future per-caller limiter) shares one implementation rather than
 * each reinventing it.
 *
 * Returns `null`, not a placeholder string, when the header is absent (a
 * direct connection with no proxy in front, or a misconfigured deployment) —
 * callers that key a rate-limit bucket on this need to tell "no IP available"
 * from "a real IP" so a headerless request doesn't get pooled with every
 * other headerless caller into one shared bucket.
 */
export async function getRequestIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || null;
}

/**
 * The caller's IP as the PLATFORM reports it: `x-real-ip`, which Vercel sets from the connection itself. Used for the signup-code limits (S1-101 review).
 *
 * Deliberately NOT `x-forwarded-for`, and not even its last entry: that header is a list a client can write to, and the leftmost entry is whatever the client
 * said. Vercel's documentation says it overwrites the header so a client cannot spoof it, but that is a property of one platform; this function does not rely on it.
 * No `x-real-ip` (a direct connection, CI, local development) is null, and a null IP is treated as "no distinguishable caller": the per-address limits still apply
 * and no per-IP key is written, the same precedent as every other limiter here.
 */
export async function getTrustedClientIp(): Promise<string | null> {
  const value = (await headers()).get("x-real-ip")?.trim();
  return value || null;
}
