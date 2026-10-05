import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { hashedEmailKey } from "./email-key";
import { CODE_RESEND_COOLDOWN_SECONDS } from "./signup-pending-codec";

/**
 * The one-minute pause between codes for one address, kept BY THE SERVER (S1-101 review). The pending-signup cookie also carries when the code went out, but
 * that cookie is unsigned and a caller can clear it or write a new one, so it can only drive the countdown on the page: it must never be what stops someone from
 * sending a stranger repeated emails. This is: one send per clock minute per address, through the existing atomic counter (`consume_anonymous_rate_limit`,
 * 0117; no new table), keyed on the hashed address. The signup itself takes the first slot (its own email is a send), so a resend right after signing up is held too.
 *
 * ONE PER CLOCK MINUTE, not "60 seconds since the last send": the counter's windows are fixed and clock-aligned, so two sends can fall either side of a minute
 * boundary a moment apart. That is bounded by the daily limits that apply to every send (5 per address and 20 per IP per day) and by Supabase's own pause per
 * user, and it does not depend on anything the caller controls.
 */
export const CODE_RESEND_COOLDOWN = { limit: 1, windowSeconds: CODE_RESEND_COOLDOWN_SECONDS } as const;
const BUCKET = "codeResendCooldown";

export type CodeResendCooldown = { allowed: true } | { allowed: false; secondsLeft: number | null };

/** Takes this minute's one slot for the address. secondsLeft is how long until the minute ends; null when the counter could not be written (fails CLOSED). */
export async function consumeCodeResendCooldown(email: string): Promise<CodeResendCooldown> {
  const { data, error } = await createServiceRoleClient().rpc("consume_anonymous_rate_limit", {
    p_key: hashedEmailKey(email),
    p_bucket: BUCKET,
    p_limit: CODE_RESEND_COOLDOWN.limit,
    p_window_seconds: CODE_RESEND_COOLDOWN.windowSeconds,
  });
  const row = data?.[0];
  if (error || !row) {
    // No key and no address in the log.
    console.error("[code-resend-cooldown] counter failed, denying");
    return { allowed: false, secondsLeft: null };
  }
  if (row.allowed) return { allowed: true };
  const left = Math.ceil((Date.parse(row.resets_at) - Date.now()) / 1000);
  return { allowed: false, secondsLeft: Math.min(CODE_RESEND_COOLDOWN_SECONDS, Math.max(1, left)) };
}
