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
  /*
   * Private share links minted by an UNVERIFIED org (0107).
   *
   * Tighter than the two above, and for a different reason. Those protect
   * spend — the failure is a bill. This protects the domain's name: every mint
   * turns an unvetted signup's posting into a live, Talentrah-branded public
   * URL, and the failure is a spam link carrying our name, which is worse per
   * event than one wasted model call.
   *
   * Five distinct JOBS per day, not five clicks: minting happens once per
   * posting, so re-viewing a link already minted costs nothing. A real
   * employer setting up has a handful of roles; five in one day before
   * verifying is already brisk.
   *
   * The window is a fixed UTC-aligned tumbling bucket, not rolling —
   * `consume_rate_limit` (0038) floors epoch/window. So five at 23:50 and five
   * more at 00:10 is reachable. Accepted deliberately: it is the same
   * trade-off already live for both buckets above, and narrowing it means
   * changing shared infrastructure for one caller.
   */
  unlistedLinkMint: { limit: 5, windowSeconds: 60 * 60 * 24 },
  /*
   * Banner uploads (0115). Counted per employer, per day.
   *
   * Tighter than resumeParse's 20/h because the cost is different in kind: a
   * resume parse spends CPU and is discarded, while a banner lands in a public
   * bucket and is then served on every view of that posting. 20 is generous
   * against the real use — an employer with a handful of live postings,
   * re-cropping one a few times — and it bounds how fast a single account can
   * fill a free-plan bucket nobody is watching yet.
   */
  jobBannerUpload: { limit: 20, windowSeconds: 60 * 60 * 24 },
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
