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
