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
 * THIS REMAINS TRUE NOW THAT `expires_at` IS POPULATED FOR EXTERNAL ROWS TOO.
 * A schema.org source's `validThrough`, when it states one, is written to
 * this same column (src/lib/jobs/ingest.ts's row mapper) so it can reach the
 * JSON-LD builder and any page state that wants it — src/lib/seo/job-posting
 * -jsonld.ts already emits it as `validThrough` markup. That is a read of
 * the column, not a second writer of the close decision: this function's
 * `.eq("source_type", "internal")` is unchanged, so an external row's
 * `expires_at` is never consulted here, however far in the past it is. Its
 * closure stays exactly what it always was — presence-driven, decided by
 * `ingestAllSources`' freshness sweep noticing the source stopped serving it,
 * never by a date on the row.
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

/**
 * How long an external posting may go un-reconfirmed before this closes it,
 * independent of whether its source is still configured at all.
 *
 * ── WHY THIS EXISTS ALONGSIDE THE PRESENCE-DRIVEN SWEEP, NOT INSTEAD OF IT ──
 *
 * `ingestAllSources`' own freshness sweep (src/lib/jobs/ingest.ts) already
 * closes a posting the moment its source affirmatively stops listing it —
 * that stays the PRIMARY mechanism and is unchanged by this. But it only ever
 * runs for an `external_source` key that is STILL in `JOB_SOURCES` today: a
 * board removed from the config (a company shuts down, a source gets
 * disqualified, a token goes stale) leaves its old rows with nothing left to
 * re-visit them, `open` forever. The same gap opens more quietly whenever a
 * source's fetch keeps tripping the empty-fetch guard — every run that
 * returns zero postings while some are still `open` deliberately SKIPS
 * closure (an empty response is not evidence, see ingest.ts), so a source
 * that stays broken for days never gets a chance to close anything either.
 *
 * `last_checked_at` is the backstop for both, because it is written
 * unconditionally by every successful upsert (ingest.ts's row mapper) and by
 * nothing else — an external row's `last_checked_at` ages exactly when
 * nothing has re-confirmed it, for whatever reason. This closes on THAT
 * silence directly, rather than trying to enumerate every way a source can
 * stop being re-visited.
 *
 * ── WHY 72 HOURS, GIVEN THE INGEST CRON NOW RUNS EVERY 3 HOURS ──────────────
 *
 * At a healthy 3-hourly cadence (.github/workflows/ingest-jobs-3hourly.yml,
 * with the daily Vercel cron as backstop), anything still genuinely live gets
 * `last_checked_at` bumped roughly 8 times a day. 72 hours is 24 MISSED
 * cycles at that cadence — comfortably past "a run or two glitched" and into
 * "this posting has had no evidence behind it for three full days," which is
 * the same bar `freshness-note.ts`'s WARNING already uses for its own
 * evidence window, just shorter here because the cadence this closure backs
 * up is shorter than the daily one that note was written against.
 *
 * ── WHY THIS NEVER TOUCHES `expires_at` ──────────────────────────────────
 *
 * `expires_at` on an external row is a fact a SOURCE stated (`validThrough`)
 * — see ingest.ts and job-posting-jsonld.ts — and this closure fires whether
 * or not one exists. Writing a value into it here would be inventing a
 * `validThrough` no source ever published, exactly what the omit-don't-guess
 * rule forbids. This sweep changes `status` only.
 *
 * ── WHY `internal` STAYS OUT, THE SAME LINE 0053/THIS FILE ALREADY DRAWS ───
 *
 * An internal posting has no external source to go silent — the employer's
 * own row is never "unconfirmed," there is nothing to re-check it against.
 * `last_checked_at` is set once at insert/update by the employer's own write
 * and is never touched again, so ageing it would eventually close every
 * internal posting on the board for a reason that has nothing to do with
 * whether the role is still open.
 */
export const EXTERNAL_STALE_AFTER_HOURS = 72;

export async function closeStaleExternalPostings(
  now: Date = new Date(),
): Promise<ExpirySweepResult> {
  const supabase = createServiceRoleClient();
  const cutoff = new Date(now.getTime() - EXTERNAL_STALE_AFTER_HOURS * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("job_postings")
    .update({ status: "closed" })
    .eq("source_type", "external")
    .eq("status", "open")
    .lt("last_checked_at", cutoff.toISOString())
    .select("id");

  if (error) throw error;

  const ids = (data ?? []).map((row) => row.id);
  return { closed: ids.length, ids };
}
