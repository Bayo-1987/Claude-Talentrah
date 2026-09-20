import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isUnidentifiableCaller } from "@/lib/security/login-rate-limit";

/**
 * send-405 — per-IP throttling for account creation. Signup has had zero
 * abuse protection: no rate limit, no CAPTCHA, no honeypot (founder decision:
 * rate limiting + honeypot, no CAPTCHA — keep the flow frictionless for real
 * users; a honeypot doesn't fit a signup form the way it does the contact
 * form, since every field here is something a real signer-upper genuinely
 * fills in).
 *
 * Same shape as `security/login-rate-limit.ts` and `auth/resend-rate-limit.ts`
 * — a caller with no session and no user id yet — so this reuses the
 * identical `consume_anonymous_rate_limit` (0117) RPC and the same
 * loopback-caller handling those two already established, rather than a
 * third parallel mechanism. Not folded into `LOGIN_RATE_LIMITS` itself:
 * that file's own name and header are specifically about throttling a
 * password *login* attempt, and a signup is a different action with a very
 * different legitimate-use frequency (a handful of accounts per IP ever, not
 * repeated login retries), so it gets its own bucket and its own tighter
 * number rather than stretching that file's stated scope.
 *
 * 5 per IP per hour: deliberately tighter than seekerLogin's 20/15min
 * (~80/hour) — creating an account is a low-frequency legitimate action (one
 * real person very rarely needs more than one or two attempts an hour, even
 * accounting for a shared-IP household/office), so this can afford to run
 * tight without a realistic false-positive cost.
 */
const SIGNUP_RATE_LIMIT = { limit: 5, windowSeconds: 60 * 60 } as const;

export interface SignupRateLimitOutcome {
  allowed: boolean;
  resetsAt: string | null;
}

export async function consumeSignupRateLimit(ip: string | null): Promise<SignupRateLimitOutcome> {
  if (isUnidentifiableCaller(ip)) return { allowed: true, resetsAt: null };

  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("consume_anonymous_rate_limit", {
    p_key: ip!,
    p_bucket: "signup",
    p_limit: SIGNUP_RATE_LIMIT.limit,
    p_window_seconds: SIGNUP_RATE_LIMIT.windowSeconds,
  });

  if (error) {
    // Fail CLOSED, same discipline as consumeLoginRateLimit/consumeRateLimit:
    // a counter that cannot be read is not evidence of headroom.
    console.error("[signup-rate-limit] check failed, denying:", error);
    return { allowed: false, resetsAt: null };
  }

  const row = data?.[0];
  if (!row) return { allowed: false, resetsAt: null };
  return { allowed: row.allowed, resetsAt: row.resets_at };
}
