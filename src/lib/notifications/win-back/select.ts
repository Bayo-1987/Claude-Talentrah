/**
 * send-467, part 3 — the calendar-driven win-back email.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM THE PROACTIVE "EXCEPTIONAL MATCH" ALERT ─
 *
 * Fixing the dormancy signal (0195, and see
 * `proactive-match-alert/select.ts`'s own header for the bug) only repairs
 * that EXISTING alert — and that alert only ever fires when a new Excellent
 * match ALSO shows up in the same ingest run. A user who has been gone 20
 * days with no fresh Excellent match in that window currently hears nothing,
 * ever, ever again, no matter how dormant they are. This is the one
 * genuinely new send this project asked for: a CALENDAR trigger ("you've
 * been away 14-21 days"), not an EVENT trigger ("a new Excellent match just
 * appeared").
 *
 * ── THE WINDOW: 14–21 DAYS, BOUNDED ON BOTH ENDS ───────────────────────────
 *
 * The lower bound matches `NOT_ACTIVELY_SEARCHING_DAYS` deliberately — this
 * send and the proactive alert agree on what "dormant" means, because they
 * are two different reactions to the same underlying fact, not two
 * independent thresholds someone could accidentally let drift apart.
 *
 * The upper bound is the part a naive "14+ days" reading misses: WITHOUT it,
 * a user who never comes back would get re-evaluated by this cron every
 * single day forever, and — if the dedup below did not also hold — re-mailed
 * every single day forever. 21 days (one week past the dormancy threshold)
 * is the ONE deliberate send for this episode; a person still gone a month
 * later has already been told once and does not need a second, third, and
 * thirtieth copy of the same message.
 *
 * ── DEDUP: SEE THE MIGRATION (0196), NOT A SEPARATE TABLE HERE ─────────────
 *
 * `isEligibleForWinbackDedup` below is the one-line policy; 0196's own header
 * has the full reasoning for why comparing `win_back_last_sent_at` against
 * `last_active_at` (rather than a fixed lookback, or a separate per-episode
 * table) is sufficient to guarantee "at most once per dormancy episode".
 *
 * Pure and exported, matching this repo's own standing convention
 * (digest/select.ts, proactive-match-alert/select.ts): the policy is
 * testable without a database, and the wiring around it (send.ts) is tested
 * separately with a mocked service-role client.
 */

/** Matches `NOT_ACTIVELY_SEARCHING_DAYS` in proactive-match-alert/select.ts —
 * see this file's own header for why the two agree on purpose. */
export const WINBACK_MIN_DAYS = 14;

/** One send per episode, not one per day for a month — see this file's own
 * header for why an upper bound exists at all. */
export const WINBACK_MAX_DAYS = 21;

/** At least one new matching posting has to exist, or "here's what's new" has
 * nothing to say — the same "a quiet week is a silent week" reasoning
 * digest/select.ts's own `MIN_JOBS` gate already applies. */
export const MIN_WINBACK_POSTINGS = 1;

function daysSince(isoTimestamp: string, now: Date): number {
  return (now.getTime() - new Date(isoTimestamp).getTime()) / 86_400_000;
}

/**
 * `lastActiveAt` is `profiles.last_active_at` (0195). A user who has never
 * registered a real visit (null) has no known episode start to measure a
 * window from, so — unlike `isNotActivelySearching`'s null-means-dormant
 * reading for the OTHER alert — this returns false rather than guessing:
 * there is no "since" for a win-back email to reference.
 */
export function isWithinWinbackWindow(lastActiveAt: string | null, now: Date): boolean {
  if (!lastActiveAt) return false;
  const days = daysSince(lastActiveAt, now);
  return days >= WINBACK_MIN_DAYS && days <= WINBACK_MAX_DAYS;
}

/**
 * True unless a win-back email has already gone out SINCE this user's
 * current episode started (i.e. since `lastActiveAt`). See 0196's own
 * header for why this one comparison is the whole dedup mechanism.
 */
export function isEligibleForWinbackDedup(lastActiveAt: string, lastWinbackSentAt: string | null): boolean {
  if (!lastWinbackSentAt) return true;
  return lastWinbackSentAt < lastActiveAt;
}

export interface WinbackCandidate {
  userId: string;
  email: string;
  firstName: string | null;
  /** False when the candidate has no base resume to score new postings
   * against — nothing to report "what's new" against. */
  hasBaseResume: boolean;
  lastActiveAt: string | null;
  lastWinbackSentAt: string | null;
}

/**
 * Whether this candidate may receive a win-back email AT ALL this run —
 * independent of whether any postings actually exist to tell them about.
 * Pure, matching `candidateIsEligible`'s own shape one module over.
 */
export function winbackCandidateIsEligible(candidate: WinbackCandidate, now: Date): boolean {
  if (!candidate.hasBaseResume) return false;
  if (!isWithinWinbackWindow(candidate.lastActiveAt, now)) return false;
  // lastActiveAt is guaranteed non-null here — isWithinWinbackWindow already
  // returned false above for a null value.
  if (!isEligibleForWinbackDedup(candidate.lastActiveAt!, candidate.lastWinbackSentAt)) return false;
  return true;
}

export interface WinbackMatchedPosting {
  jobId: string;
  title: string;
  companyName: string;
  location: string | null;
  score: number;
  explanation?: unknown;
}

export interface WinbackEmailContent {
  /** Every listable posting scored Good/Excellent since the user went
   * dormant — the count the email headlines with, not just the examples
   * shown underneath it. */
  totalCount: number;
  /** Up to `MAX_WINBACK_EXAMPLES`, highest-scoring first — the "2-3 example
   * postings" the spec asks for, never the full list. */
  examples: WinbackMatchedPosting[];
}

/** Keep the email a headline and a handful of examples, not a second digest. */
export const MAX_WINBACK_EXAMPLES = 3;

/**
 * Picks what one eligible person's win-back email actually reports, or
 * returns null meaning "send nothing" — the same "quiet week is a silent
 * send" shape `selectDigestJobs` already uses, applied to "nothing new
 * happened while you were away" instead of "nothing new happened this week".
 */
export function selectWinbackContent(matched: WinbackMatchedPosting[]): WinbackEmailContent | null {
  if (matched.length < MIN_WINBACK_POSTINGS) return null;
  const sorted = [...matched].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return {
    totalCount: sorted.length,
    examples: sorted.slice(0, MAX_WINBACK_EXAMPLES),
  };
}
