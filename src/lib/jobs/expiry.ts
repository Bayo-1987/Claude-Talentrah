import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Close internal postings whose employer-set expiry has passed.
 *
 * ── WHY THIS EXISTS NOW, WHEN 0053 DELIBERATELY LEFT THE COLUMN INERT ─────
 *
 * 0053 added `expires_at` and read it from nowhere, on purpose, and said so:
 * "until something reads it, this column affects nothing. A row with
 * `expires_at` in the past stays `open` and stays in the feed. That is
 * expected, not a bug to be found later." It reserved the close-on-expiry
 * rule as a decision to be made on its own rather than smuggled in.
 *
 * This is that decision, made explicitly. What forced it is that the employer
 * job form now OFFERS an expiry. That changes what the column means: it used
 * to hold a fact an ingest source stated, and it now also holds a commitment
 * the product made to an employer who chose "Expires in 30 days". Leaving it
 * inert was honest while nothing populated it from the UI; leaving it inert
 * once a human can set it would mean the product shows a control that does
 * nothing, which is worse than not offering the control at all.
 *
 * ── WHY `internal` ONLY ───────────────────────────────────────────────────
 *
 * 0053's stated objection was a real one: "an expiry date the employer forgot
 * to extend silently removing a job the board is still advertising." That
 * failure needs two authorities disagreeing about the same row — and it can
 * only happen for EXTERNAL postings, where the board is the authority and
 * `last_checked_at` is the evidence. For an internal posting there is no
 * board: the employer typed the posting and typed the date, so their stated
 * expiry IS the source of truth and nothing else claims that row.
 *
 * So this does not overrule 0053 — it takes the exact case 0053 was worried
 * about and leaves it alone. External postings keep closing only when their
 * source stops serving them, unchanged.
 *
 * ── WHY CLOSE THE ROW RATHER THAN FILTER AT READ TIME ─────────────────────
 *
 * Because `status` is a gate every surface already honours — the feed query,
 * the detail page, the sitemap, the JSON-LD builder, matching. Adding
 * "…and not expired" to each of those is N places to get right and N+1 places
 * to forget when the next surface is written, which is precisely the class of
 * miss this repo keeps finding. One writer, one column, and every existing
 * reader is correct for free.
 */
export type ExpirySweepResult = {
  closed: number;
  ids: string[];
};

export async function closeExpiredInternalPostings(
  now: Date = new Date(),
): Promise<ExpirySweepResult> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("job_postings")
    .update({ status: "closed" })
    .eq("source_type", "internal")
    .eq("status", "open")
    /*
     * `.lt` alone would be wrong: in PostgREST a comparison against NULL is
     * NULL, not false, so this reads as "has an expiry AND it has passed".
     * The explicit not-null is belt and braces — it makes the intent legible
     * and survives someone rewriting the comparison.
     */
    .not("expires_at", "is", null)
    .lt("expires_at", now.toISOString())
    .select("id");

  // A rejected update RESOLVES with an error rather than throwing — the
  // failure mode that let ten cleanup sites report success for weeks.
  if (error) throw error;

  const ids = (data ?? []).map((row) => row.id);
  return { closed: ids.length, ids };
}
