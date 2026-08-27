import type { Tables } from "@/lib/supabase/types";

/**
 * The age at which an external listing stops being self-explanatory.
 *
 * Not tuned to a distribution — chosen because it is roughly four months,
 * long enough that a reader who sees it will already be wondering, and short
 * enough to still catch the postings that matter. On the board this was
 * written against it selects 7 of 150 open postings (all from the schema.org
 * Workable source; the Greenhouse boards' oldest open listing is 86 days), so
 * the note is rare by construction rather than by a cap.
 *
 * If it ever starts firing on a large share of the feed, that is a signal
 * about a source's hygiene, not a reason to raise the number.
 */
export const FRESHNESS_NOTE_AGE_DAYS = 120;

/**
 * How recently the source must have re-confirmed the posting for the second
 * half of the sentence to be true.
 *
 * The note asserts two things, and only the first comes from `posted_at`.
 * "Still shown as open by the source" is a claim about the SOURCE, and the
 * only evidence for it is `last_checked_at` — the timestamp the ingest writes
 * when a fetch affirmatively returned this posting.
 *
 * `status = 'open'` alone does NOT support that claim. The ingest's empty-fetch
 * guard (see `src/lib/jobs/ingest.ts`) deliberately declines to close anything
 * when a source returns zero postings, because an empty response is not
 * evidence a job ended. That is the right call for the feed — but it means an
 * open posting can be one we merely failed to disprove rather than one the
 * source re-served. Saying "still shown as open by the source" about such a
 * posting would be inventing the evidence.
 *
 * Seven days, because ingest runs daily (`vercel.json`, 05:00). Crossing this
 * window means seven consecutive runs failed to see the posting, which is a
 * broken source, not jitter. On today's board every open posting was confirmed
 * within the last few hours, so this gate is a no-op until something breaks —
 * which is exactly when it should start suppressing the claim.
 */
export const FRESHNESS_NOTE_CONFIRMATION_WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The wording is deliberately two facts and no advice.
 *
 * The reference mock phrased its version as "worth checking it's still open",
 * which is a judgment, and one this system's data actively contradicts: our
 * ingest re-confirms every open external posting daily. An old listing that a
 * source keeps serving is a fact worth knowing; whether it is worth the
 * seeker's time is theirs to decide.
 */
const NOTE = `First listed ${FRESHNESS_NOTE_AGE_DAYS}+ days ago — still shown as open by the source.`;

type FreshnessInput = Pick<
  Tables<"job_postings">,
  "source_type" | "posted_at" | "last_checked_at"
>;

function ageInDays(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (now - then) / DAY_MS;
}

/**
 * The one honest freshness flag from finding 04, or null when we cannot back
 * both halves of it.
 *
 * Internal postings never qualify. There is no external "still listed" signal
 * to react to for a job an employer posted here directly — its state is
 * whatever the employer last set, and reporting our own record back to the
 * reader as third-party confirmation would be circular.
 */
export function freshnessNote(job: FreshnessInput, now: number = Date.now()): string | null {
  if (job.source_type !== "external") return null;

  const age = ageInDays(job.posted_at, now);
  if (age === null || age < FRESHNESS_NOTE_AGE_DAYS) return null;

  const sinceConfirmed = ageInDays(job.last_checked_at, now);
  if (sinceConfirmed === null || sinceConfirmed > FRESHNESS_NOTE_CONFIRMATION_WINDOW_DAYS) {
    return null;
  }

  return NOTE;
}
