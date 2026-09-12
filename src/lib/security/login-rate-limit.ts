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
 * A LIVE BUG THIS CAUGHT, immediately, the first time this ran anywhere but
 * this module's own unit tests: every e2e spec in this repo's own CI suite
 * shares ONE loopback connection to the ephemeral local server, so
 * `getRequestIp()` resolves to the literal string `"::1"` for every single
 * login across the whole ~250-file suite — not `null`. A first version of
 * this function failed CLOSED on a missing IP, reasoning that "a legitimate
 * deployment behind Vercel always sets this header, so this path is not
 * expected to be hit in production" — true, but it missed that CI (and any
 * plain `next start` with no reverse proxy in front, including local dev)
 * hits a DIFFERENT path: a real, non-null, loopback IP, shared by every
 * caller because there is no proxy distinguishing them. That version passed
 * its own tests (which all supply a synthetic non-loopback IP) and then
 * failed roughly 30 unrelated e2e specs in one CI run, each unable to log in
 * at all once the shared "::1" bucket's budget ran out partway through the
 * suite — caught only by actually running the real login form, not by any
 * automated test here.
 *
 * So: `null` (header absent) and a loopback literal (`127.0.0.1`, `::1`, or
 * the IPv4-mapped form of either) are both treated as "no distinguishable
 * real external caller" — and BOTH are treated as `allowed: true` (this
 * layer skips, not fails closed), matching the established precedent in
 * `resend-rate-limit.ts`'s own IP bucket rather than inventing a new
 * convention: an unidentifiable caller is not evidence of an attacker, and
 * Supabase's own shared per-source-IP limit (the thing this module exists to
 * add a second layer in front of) remains the backstop either way. A real
 * production deployment behind Vercel's own reverse proxy never presents a
 * loopback address as the caller's IP — if this path is ever hit in
 * production, something is misconfigured, and failing OPEN on that specific
 * failure is the safer direction: it degrades to "no extra throttle," not
 * "every real user's login stops working."
 */
const LOOPBACK_LITERALS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function isUnidentifiableCaller(ip: string | null): boolean {
  return !ip || LOOPBACK_LITERALS.has(ip);
}

export async function consumeLoginRateLimit(
  ip: string | null,
  bucket: LoginRateLimitBucket,
): Promise<LoginRateLimitOutcome> {
  if (isUnidentifiableCaller(ip)) return { allowed: true, resetsAt: null };

  const { limit, windowSeconds } = LOGIN_RATE_LIMITS[bucket];
  const admin = createServiceRoleClient();

  const { data, error } = await admin.rpc("consume_anonymous_rate_limit", {
    // Non-null: isUnidentifiableCaller's early return above is what makes
    // this safe — it's the only guard, deliberately not written as a type
    // predicate, since it's also true for certain non-null (loopback)
    // strings and a predicate narrowing to `ip is string` would be
    // technically dishonest about what the check actually tests.
    p_key: ip!,
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
