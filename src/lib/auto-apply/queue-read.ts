import { AUTO_APPLY_MIN_SCORE } from "@/lib/auto-apply/config";
import { isThinScreenableTagSet, screenableTagTotalFromExplanation } from "@/lib/match-tier";
import type { MatchExplanation } from "@/lib/matching/score";

/**
 * Which pending queue rows the review page may LIST (send-506, A1).
 *
 * The page promises "Roles scoring 80%+ against your resume land here", and a user reads that screen as the
 * truth. It used to print every `status = 'pending'` row with the score frozen at queue time. Production showed
 * what that costs: 13 pending rows, 11 queued before the thin-match gate existed, 9 of them "99% Excellent" for
 * jobs that were by then CLOSED (7) or had no current score at all (8), so nothing was left to qualify the
 * number and the stale snapshot was printed as if it were current.
 *
 * A row is listed only when something CURRENT vouches for it: the job is open, a live `match_scores` row exists,
 * that live score is at least AUTO_APPLY_MIN_SCORE, and its screenable-tag set is not thin. Missing evidence
 * fails closed (a missing live row, a malformed explanation, an unreadable job): an autonomous action's queue
 * needs positive evidence, not the absence of a reason to hide it. The same rules the confirm-time gate
 * (`auto_apply_claim_submission`, 0034/0164) applies, which this does not replace: that gate stays the backstop
 * and refuses these rows regardless of what the page shows.
 *
 * Hidden rows are NOT deleted or expired here: this is a read. They remain `pending` in the table.
 */
export interface LiveScore {
  score: number;
  explanation: unknown;
}

export function isWellFormedExplanation(explanation: unknown): explanation is MatchExplanation {
  return (
    explanation !== null &&
    typeof explanation === "object" &&
    Array.isArray((explanation as MatchExplanation).matchedSkills) &&
    Array.isArray((explanation as MatchExplanation).missingSkills)
  );
}

export function isListableQueueRow(
  row: { job_postings: { status?: string | null } | null },
  live: LiveScore | undefined,
): boolean {
  if (row.job_postings?.status !== "open") return false;
  if (!live) return false;
  if (live.score < AUTO_APPLY_MIN_SCORE) return false;
  if (!isWellFormedExplanation(live.explanation)) return false;
  // The same thin-set rule the queue-time filter and the confirm-time gate use (match-tier.ts is the one source),
  // read from match-tier directly so this stays a pure module with no database imports.
  const total = screenableTagTotalFromExplanation(live.explanation);
  return total !== null && !isThinScreenableTagSet(total);
}
