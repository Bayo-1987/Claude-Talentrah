import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isUnidentifiableCaller } from "@/lib/security/login-rate-limit";
import { hashedEmailKey } from "./email-key";

/**
 * The attempt limit on the signup code (S1-101): FAILED attempts only, 6 per email and 30 per IP, each per 15 minutes. NO NEW TABLE and no migration: it
 * uses `anonymous_rate_limits` and `consume_anonymous_rate_limit` (0117), plus a read of the same table.
 *
 * WHY NOT SUPABASE'S OWN VERIFY LIMIT. Supabase limits token verifications per source IP, but this app calls it from its own server, so the IP it sees is
 * ours: one shared ceiling for every signup, not a throttle on any one guesser (the same gap src/lib/security/login-rate-limit.ts documents for passwords).
 *
 * TWO PARTS, because "count failures only" is a read-then-act gate and a read-then-act gate is not a limit under concurrency (CLAUDE.md: anything that gates on
 * a counted value must check and act in ONE statement). A burst of parallel guesses would all read "0 failures" before any of them recorded one.
 *   1. The ATOMIC CEILING: every attempt, right or wrong, takes one slot from `codeBurstEmail` (12) and `codeBurstIp` (60) through the existing
 *      increment-and-read function. Only that many attempts per window can ever reach Supabase, however many are in flight.
 *   2. The FAILURE COUNT: `codeFailEmail` (6) and `codeFailIp` (30) are incremented only after Supabase rejected a code, and READ (not incremented) before
 *      the next attempt. A correct code therefore never uses any of it, and the sixth wrong code is the last one tried.
 * Both buckets of a pair are always consumed, even when the first denies, so a caller cannot tell from the response which one tripped.
 *
 * The address is hashed in the key: this table's key column is a free-text identifier and the address needs no readable copy there. A caller whose IP cannot be
 * told apart (no header, or loopback) gets no per-IP bucket, the same precedent as login-rate-limit.ts.
 */
export const CODE_ATTEMPT_LIMITS = {
  failEmail: { limit: 6, windowSeconds: 15 * 60 },
  failIp: { limit: 30, windowSeconds: 15 * 60 },
  burstEmail: { limit: 12, windowSeconds: 15 * 60 },
  burstIp: { limit: 60, windowSeconds: 15 * 60 },
} as const;

type Bucket = keyof typeof CODE_ATTEMPT_LIMITS;
// The bucket names stored in the table's `bucket` column.
const BUCKET_NAME: Record<Bucket, string> = {
  failEmail: "codeFailEmail",
  failIp: "codeFailIp",
  burstEmail: "codeBurstEmail",
  burstIp: "codeBurstIp",
};

export type CodeAttemptGate = { allowed: true } | { allowed: false; resetsAt: string | null };

async function consume(key: string, bucket: Bucket): Promise<{ allowed: boolean; resetsAt: string | null }> {
  const { limit, windowSeconds } = CODE_ATTEMPT_LIMITS[bucket];
  const { data, error } = await createServiceRoleClient().rpc("consume_anonymous_rate_limit", {
    p_key: key,
    p_bucket: BUCKET_NAME[bucket],
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    // Fail CLOSED, like every limiter here: a counter that cannot be written is not evidence of headroom. No key and no address in the log.
    console.error(`[code-attempt-limit] ${bucket} counter failed, denying`);
    return { allowed: false, resetsAt: null };
  }
  const row = data?.[0];
  if (!row) return { allowed: false, resetsAt: null };
  return { allowed: row.allowed, resetsAt: row.resets_at };
}

/** How many failures this key has in the current window, WITHOUT counting this call. null when it cannot be read. */
async function failuresSoFar(key: string, bucket: "failEmail" | "failIp"): Promise<{ count: number; resetsAt: string } | null> {
  const { windowSeconds } = CODE_ATTEMPT_LIMITS[bucket];
  const startSeconds = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const { data, error } = await createServiceRoleClient()
    .from("anonymous_rate_limits")
    .select("request_count")
    .eq("rate_key", key)
    .eq("bucket", BUCKET_NAME[bucket])
    .eq("window_start", new Date(startSeconds * 1000).toISOString())
    .maybeSingle();
  if (error) {
    console.error(`[code-attempt-limit] ${bucket} count unreadable, denying`);
    return null;
  }
  return { count: data?.request_count ?? 0, resetsAt: new Date((startSeconds + windowSeconds) * 1000).toISOString() };
}

/** Call BEFORE asking Supabase to check a code. allowed:false means do not call it. */
export async function gateCodeAttempt(email: string, ip: string | null): Promise<CodeAttemptGate> {
  const key = hashedEmailKey(email);
  const useIp = !isUnidentifiableCaller(ip);

  const burstEmail = await consume(key, "burstEmail");
  const burstIp = useIp ? await consume(ip!, "burstIp") : { allowed: true, resetsAt: null };
  if (!burstEmail.allowed) return { allowed: false, resetsAt: burstEmail.resetsAt };
  if (!burstIp.allowed) return { allowed: false, resetsAt: burstIp.resetsAt };

  const failEmail = await failuresSoFar(key, "failEmail");
  const failIp = useIp ? await failuresSoFar(ip!, "failIp") : { count: 0, resetsAt: "" };
  if (!failEmail || !failIp) return { allowed: false, resetsAt: null };
  if (failEmail.count >= CODE_ATTEMPT_LIMITS.failEmail.limit) return { allowed: false, resetsAt: failEmail.resetsAt };
  if (useIp && failIp.count >= CODE_ATTEMPT_LIMITS.failIp.limit) return { allowed: false, resetsAt: failIp.resetsAt };
  return { allowed: true };
}

/** Call AFTER Supabase rejected a code. Never throws. */
export async function recordFailedCodeAttempt(email: string, ip: string | null): Promise<void> {
  await consume(hashedEmailKey(email), "failEmail");
  if (!isUnidentifiableCaller(ip)) await consume(ip!, "failIp");
}
