import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isUnidentifiableCaller } from "@/lib/security/login-rate-limit";

/**
 * send-405 — per-IP throttling for the public contact form. Same shape as
 * `security/login-rate-limit.ts` and `auth/{signup,resend}-rate-limit.ts` —
 * a caller with no session and no user id — so this reuses the identical
 * `consume_anonymous_rate_limit` (0117) RPC and the same loopback-caller
 * handling those already established, rather than a third/fourth parallel
 * mechanism.
 *
 * 3 per IP per hour: a real human contacting support doesn't submit this
 * form more than a couple of times in a short window even if they're
 * following up on the same issue — tighter than signup's 5/hour since this
 * action has no legitimate reason to repeat as often as account creation
 * occasionally does (e.g. a shared household signing up multiple accounts).
 */
const CONTACT_RATE_LIMIT = { limit: 3, windowSeconds: 60 * 60 } as const;

export interface ContactRateLimitOutcome {
  allowed: boolean;
  resetsAt: string | null;
}

export async function consumeContactRateLimit(ip: string | null): Promise<ContactRateLimitOutcome> {
  if (isUnidentifiableCaller(ip)) return { allowed: true, resetsAt: null };

  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("consume_anonymous_rate_limit", {
    p_key: ip!,
    p_bucket: "contact",
    p_limit: CONTACT_RATE_LIMIT.limit,
    p_window_seconds: CONTACT_RATE_LIMIT.windowSeconds,
  });

  if (error) {
    // Fail CLOSED, same discipline as every other limiter in this family: a
    // counter that cannot be read is not evidence of headroom.
    console.error("[contact-rate-limit] check failed, denying:", error);
    return { allowed: false, resetsAt: null };
  }

  const row = data?.[0];
  if (!row) return { allowed: false, resetsAt: null };
  return { allowed: row.allowed, resetsAt: row.resets_at };
}
