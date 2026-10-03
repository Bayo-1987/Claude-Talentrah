import { isListableQueueRow, type LiveScore } from "@/lib/auto-apply/queue-read";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The pending Auto-Apply rows the user may be OFFERED right now, by the one rule (isListableQueueRow: job open, live
 * score at least AUTO_APPLY_MIN_SCORE, not thin), each with its live score.
 *
 * Read by BOTH the /auto-apply review page and the "N matches are waiting for review" banner on /jobs. The banner used to
 * count every raw `status = 'pending'` row while the page (after #654) listed only the eligible ones, so production said
 * 13 over a page showing none. One function means the two cannot disagree (tests/auto-apply/pending-banner-count.test.tsx).
 */
export async function fetchListablePending(supabase: Supabase, userId: string) {
  const { data: rows } = await supabase
    .from("auto_apply_queue")
    .select(
      "id, job_posting_id, status, match_score, tier, source_type, queued_at, decided_at, credits_spent, job_postings(title, company_name, location, status)",
    )
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("queued_at", { ascending: false })
    .limit(60);
  const pending = rows ?? [];
  if (pending.length === 0) return [];

  const { data: scores } = await supabase
    .from("match_scores")
    .select("job_posting_id, score, explanation")
    .eq("user_id", userId)
    .in(
      "job_posting_id",
      pending.map((r) => r.job_posting_id),
    );
  const live = new Map<string, LiveScore>();
  for (const s of scores ?? []) live.set(s.job_posting_id, { score: s.score, explanation: s.explanation as unknown });

  return pending
    .map((row) => ({ row, live: live.get(row.job_posting_id) }))
    .filter((x): x is { row: (typeof pending)[number]; live: LiveScore } => !!x.live && isListableQueueRow(x.row, x.live));
}
