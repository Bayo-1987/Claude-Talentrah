import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { hashExtendToken, isWellFormedExtendToken } from "./token";

/**
 * Reading and redeeming an Extend link (EMP-1 / E3, migration 0205).
 *
 * TWO FUNCTIONS, DELIBERATELY UNEQUAL.
 *
 *   peekExtendToken    read-only. Answers "what would this link do?" so the confirm page can show the posting and a
 *                      button. It changes nothing, so a mail scanner or link previewer that fetches the page costs
 *                      nothing.
 *   redeemExtendToken  the ONLY thing that extends. It is one database call, `redeem_job_expiry_extend_token`, which
 *                      locks the token row, extends the posting in a single conditional UPDATE and stamps the token
 *                      used in the same transaction. Everything that must hold atomically is in SQL; nothing here
 *                      reads a value and then decides.
 *
 * Both take the raw token from the URL and hash it before touching the database: the table stores only hashes. A value
 * that is not the shape we mint is answered `invalid` without a query.
 *
 * The service-role client is the right one: the table and the functions are not reachable by any client role (0205),
 * and the link itself is the authorisation, like the unsubscribe link (src/app/unsubscribe/page.tsx).
 */

export type ExtendRefusal = "invalid" | "used" | "expired" | "unavailable";

export type ExtendResult =
  | { outcome: "extended"; jobId: string; title: string; newExpiresAt: string }
  | { outcome: ExtendRefusal; jobId?: string }
  | { outcome: "error" };

export type PeekResult =
  | { state: "ready"; jobId: string; title: string; closesAt: string }
  | { state: ExtendRefusal };

export async function redeemExtendToken(token: string, now: Date = new Date()): Promise<ExtendResult> {
  if (!isWellFormedExtendToken(token)) return { outcome: "invalid" };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("redeem_job_expiry_extend_token", {
    p_token_hash: hashExtendToken(token),
    p_now: now.toISOString(),
  });
  if (error || !data || data.length === 0) {
    console.error("[extend-posting] redeem failed:", error?.message ?? "no result");
    return { outcome: "error" };
  }

  const row = data[0];
  if (row.outcome === "extended") {
    return { outcome: "extended", jobId: row.job_posting_id, title: row.title, newExpiresAt: row.new_expires_at };
  }
  if (row.outcome === "used" || row.outcome === "expired" || row.outcome === "unavailable") {
    return { outcome: row.outcome, jobId: row.job_posting_id ?? undefined };
  }
  return { outcome: "invalid" };
}

export async function peekExtendToken(token: string, now: Date = new Date()): Promise<PeekResult> {
  if (!isWellFormedExtendToken(token)) return { state: "invalid" };

  const supabase = createServiceRoleClient();
  const { data: reminder } = await supabase
    .from("job_expiry_reminders")
    .select("job_posting_id, closes_at, used_at, sent_at")
    .eq("token_hash", hashExtendToken(token))
    .maybeSingle();

  if (!reminder) return { state: "invalid" };
  if (reminder.used_at) return { state: "used" };
  if (new Date(reminder.closes_at).getTime() <= now.getTime()) return { state: "expired" };

  const { data: job } = await supabase
    .from("job_postings")
    .select("id, title, status, source_type, expires_at")
    .eq("id", reminder.job_posting_id)
    .maybeSingle();

  // The same conditions the redeem function enforces; this only decides whether to OFFER the button.
  if (!job || job.source_type !== "internal" || job.status !== "open" || !job.expires_at) {
    return { state: "unavailable" };
  }
  return { state: "ready", jobId: job.id, title: job.title, closesAt: job.expires_at };
}
