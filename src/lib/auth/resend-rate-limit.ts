import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Rate limiting for the check-email resend actions — callers with no session
 * and no user id. See migration 0117's header for the full reasoning on why
 * this is a separate table/function from `consumeRateLimit` (0038,
 * src/lib/api/rate-limit.ts) rather than a reuse of it.
 */
export const RESEND_RATE_LIMITS = {
  /** Per recipient address. The tight one — protects a stranger's inbox. */
  resendEmail: { limit: 5, windowSeconds: 60 * 60 * 24 },
  /** Per requester IP. Looser — bounds one actor's blast radius across many addresses. */
  resendIp: { limit: 20, windowSeconds: 60 * 60 * 24 },
} as const;

export interface RateLimitOutcome {
  allowed: boolean;
  used: number;
  resetsAt: string | null;
}

async function consume(
  key: string,
  bucket: keyof typeof RESEND_RATE_LIMITS,
): Promise<RateLimitOutcome> {
  const { limit, windowSeconds } = RESEND_RATE_LIMITS[bucket];
  const admin = createServiceRoleClient();

  const { data, error } = await admin.rpc("consume_anonymous_rate_limit", {
    p_key: key,
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    // Fail CLOSED, same discipline as consumeRateLimit (0038): a counter that
    // cannot be read is not evidence of headroom.
    console.error(`[resend-rate-limit] ${bucket} check failed, denying:`, error);
    return { allowed: false, used: limit, resetsAt: null };
  }

  const row = data?.[0];
  if (!row) return { allowed: false, used: limit, resetsAt: null };
  return { allowed: row.allowed, used: row.used, resetsAt: row.resets_at };
}

/**
 * Both the email-keyed and IP-keyed buckets must allow the request, and BOTH
 * are always consumed — even once the first has already denied — so a caller
 * can never tell from behavior which one tripped. That matters here
 * specifically: these actions are otherwise careful to give an identical
 * response regardless of whether the address exists (see
 * resendSignupConfirmationAction), and a rate-limit response that only ever
 * consumed one bucket would be a second, smaller way to learn something about
 * the caller's own request pattern relative to others'.
 *
 * `ip` is nullable because `x-forwarded-for` is not guaranteed present (a
 * direct connection with no proxy in front, a misconfigured header). A
 * missing IP still applies the email bucket — the ip bucket has nothing to
 * key on and is skipped rather than treated as an automatic pass or fail.
 */
export async function consumeResendRateLimit(
  email: string,
  ip: string | null,
): Promise<RateLimitOutcome> {
  const emailOutcome = await consume(email.toLowerCase(), "resendEmail");
  const ipOutcome = ip
    ? await consume(ip, "resendIp")
    : { allowed: true, used: 0, resetsAt: null };

  if (!emailOutcome.allowed) return emailOutcome;
  if (!ipOutcome.allowed) return ipOutcome;
  return emailOutcome;
}
