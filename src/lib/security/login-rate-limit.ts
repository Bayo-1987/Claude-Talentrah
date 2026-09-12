import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Per-IP brute-force throttling for a password login, on both the seeker
 * and admin sign-in forms.
 *
 * THE GAP THIS CLOSES, stated exactly as `docs/admin-auth.md` and
 * `src/lib/admin/actions.ts`'s own comment already did: Supabase rate-limits
 * its auth token endpoint per source IP, but both login Server Actions call
 * it from THIS server, so the source IP Supabase sees is Talentrah's own —
 * the limit is one shared ceiling across every login attempt from every
 * user, not a throttle on any one attacker. A caller who wanted to guess
 * passwords against one address could burn through as many attempts as
 * Supabase allows the whole app, and everyone else's logins would start
 * failing on 429s before that caller was meaningfully slowed down.
 *
 * Reuses `consume_anonymous_rate_limit` (0117) — the same atomic, keyed-by-
 * arbitrary-text counter `resend-rate-limit.ts` already uses for the same
 * shape of problem (a caller with no session and no user id yet). Checked
 * and consumed BEFORE the real `signInWithPassword` call, not after — the
 * whole point is to stop a blocked caller from reaching Supabase's endpoint
 * at all, since that endpoint is the shared resource being protected.
 */
const LOGIN_RATE_LIMITS = {
  /**
   * Seeker login. Nigeria/Africa mobile carriers and campus/office networks
   * commonly put many real, unrelated users behind one IP (CGNAT — the same
   * carrier-grade-NAT range this repo's own SSRF guard treats as non-public
   * for the opposite reason), so this has to stay generous enough that a
   * shared IP with ordinary typo-and-retry traffic never trips it, while
   * still bounding a targeted credential-stuffing run against one address.
   */
  seekerLogin: { limit: 20, windowSeconds: 15 * 60 },
  /**
   * Admin login. Tighter — there are, at most, a handful of real operators
   * ever signing in from any given IP, so this can afford to be strict
   * without a realistic false-positive cost.
   */
  adminLogin: { limit: 8, windowSeconds: 15 * 60 },
} as const;

export type LoginRateLimitBucket = keyof typeof LOGIN_RATE_LIMITS;

export interface LoginRateLimitOutcome {
  allowed: boolean;
  resetsAt: string | null;
}

/**
 * `ip` is nullable because `x-forwarded-for` is not guaranteed present. A
 * missing IP has nothing to key a per-caller bucket on — rather than pool
 * every headerless caller into one shared key (which would let one such
 * caller lock out every other one) or silently skip the check (which would
 * make a misconfigured proxy an unnoticed way to disable this entirely),
 * this fails CLOSED: no verifiable caller identity is treated the same as a
 * caller who has already exhausted their attempts. A legitimate deployment
 * behind Vercel always sets this header, so this path is not expected to be
 * hit in production.
 */
export async function consumeLoginRateLimit(
  ip: string | null,
  bucket: LoginRateLimitBucket,
): Promise<LoginRateLimitOutcome> {
  if (!ip) return { allowed: false, resetsAt: null };

  const { limit, windowSeconds } = LOGIN_RATE_LIMITS[bucket];
  const admin = createServiceRoleClient();

  const { data, error } = await admin.rpc("consume_anonymous_rate_limit", {
    p_key: ip,
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    // Fail CLOSED, same discipline as consumeRateLimit (0038) and
    // consumeResendRateLimit (0117): a counter that cannot be read is not
    // evidence of headroom.
    console.error(`[login-rate-limit] ${bucket} check failed, denying:`, error);
    return { allowed: false, resetsAt: null };
  }

  const row = data?.[0];
  if (!row) return { allowed: false, resetsAt: null };
  return { allowed: row.allowed, resetsAt: row.resets_at };
}
