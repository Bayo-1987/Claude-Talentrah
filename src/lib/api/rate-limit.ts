import "server-only";
import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Per-user request rate limiting for the routes that spend money per call.
 *
 * The counter itself is atomic in Postgres (migration 0038) — a read-then-
 * increment in JS would let concurrent requests all see the same count and all
 * pass, which is the exact failure this is meant to prevent.
 */

export const RATE_LIMITS = {
  /** Paid model call + document generation. Generous for real use, fatal to a loop. */
  tailoring: { limit: 10, windowSeconds: 60 * 60 },
  /** Parsing is cheap until the LLM fallback fires, which is per-upload. */
  resumeParse: { limit: 20, windowSeconds: 60 * 60 },
} as const;

export interface RateLimitOutcome {
  allowed: boolean;
  used: number;
  resetsAt: string | null;
}

export async function consumeRateLimit(
  userId: string,
  bucket: keyof typeof RATE_LIMITS,
): Promise<RateLimitOutcome> {
  const { limit, windowSeconds } = RATE_LIMITS[bucket];
  const admin = createServiceRoleClient();

  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_user_id: userId,
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    /*
     * Fail CLOSED, matching how Farah's own limit is documented to behave: a
     * counter that cannot be read is not evidence of headroom. The alternative
     * — treating a database blip as "allowed" — turns the one failure mode
     * that most plausibly coincides with heavy load into an open gate.
     */
    console.error(`[rate-limit] ${bucket} check failed, denying:`, error);
    return { allowed: false, used: limit, resetsAt: null };
  }

  const row = data?.[0];
  if (!row) return { allowed: false, used: limit, resetsAt: null };
  return { allowed: row.allowed, used: row.used, resetsAt: row.resets_at };
}

/** The 429 body, shared so both routes answer identically. */
export function rateLimited(outcome: RateLimitOutcome): NextResponse {
  return NextResponse.json(
    { error: "That's a lot of requests in a short time — give it a little while and try again." },
    {
      status: 429,
      headers: outcome.resetsAt
        ? { "Retry-After": String(Math.max(1, Math.ceil((new Date(outcome.resetsAt).getTime() - Date.now()) / 1000))) }
        : {},
    },
  );
}
