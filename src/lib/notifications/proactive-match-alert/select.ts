import { getMatchTier, isThinScreenableTagSet, screenableTagTotalFromExplanation } from "@/lib/match-tier";
import type { MatchExplanation } from "@/lib/matching/score";

/**
 * send-138 — Farah's proactive "exceptional match, even if you're not
 * looking" alert (build-prompt §6.10's own worked example).
 *
 * ── "NOT ACTIVELY SEARCHING", DEFINED ──────────────────────────────────────
 *
 * No column in this schema already tracks this, so this is a judgment call,
 * stated plainly rather than assumed: a user counts as not actively
 * searching when their MOST RECENT `match_scores.computed_at` (across every
 * job they've been scored against) is older than `NOT_ACTIVELY_SEARCHING_DAYS`
 * — or they have no `match_scores` row at all.
 *
 * Chosen over a login-time proxy (`auth.users.last_sign_in_at`) for a
 * concrete reason, not by default: Supabase only stamps `last_sign_in_at` on
 * a real re-authentication, not on every request a persisted session serves —
 * someone who signed in once and has been browsing daily since on a
 * refresh-token session would read as "just signed in" forever. `match_scores
 * .computed_at` updates on every real feed/job-detail visit
 * (persistMatchScores, compute-and-store.ts), because that is precisely when
 * this app recomputes it — so it is a true recency-of-engagement signal
 * already sitting in the schema, not a new column and not a second,
 * auth-schema-crossing lookup (see 0067's own header for why reaching into
 * `auth.*` at all is a real cost this app has paid once already and should
 * not pay again for something `match_scores` already answers for free).
 *
 * 14 DAYS, not the digest's own 7: the digest's cadence is "everyone still
 * opted in, every week" — a much lower bar than "has this person drifted
 * away". Two weeks of no feed/detail visit is long enough that a genuinely
 * active seeker (visiting even sporadically) never qualifies, short enough
 * that a real dormant user is caught within one or two ingest cycles of
 * drifting past it.
 */
export const NOT_ACTIVELY_SEARCHING_DAYS = 14;

/**
 * §6.10's own line is explicit this must stay rare: "You'll only hear from
 * Farah like this for matches this strong." Matches the digest's own weekly
 * cadence rather than inventing a separate number — a user who both drifted
 * away AND keeps landing Excellent matches should hear from Farah at most
 * about as often as an engaged user hears from the digest, not more.
 */
export const RATE_LIMIT_DAYS = 7;

function daysSince(isoTimestamp: string, now: Date): number {
  return (now.getTime() - new Date(isoTimestamp).getTime()) / 86_400_000;
}

/** `lastActiveAt` is the MAX `match_scores.computed_at` for this user, or
 * null if they have no match_scores row at all — which counts as "not
 * actively searching" (nothing to the contrary), not as an exclusion. */
export function isNotActivelySearching(lastActiveAt: string | null, now: Date): boolean {
  if (!lastActiveAt) return true;
  return daysSince(lastActiveAt, now) >= NOT_ACTIVELY_SEARCHING_DAYS;
}

/** `lastAlertSentAt` is the MAX `proactive_match_alerts.sent_at` for this
 * user, across every job — null means never alerted, so never rate-limited. */
export function isWithinRateLimit(lastAlertSentAt: string | null, now: Date): boolean {
  if (!lastAlertSentAt) return false;
  return daysSince(lastAlertSentAt, now) < RATE_LIMIT_DAYS;
}

/**
 * Reuses the system's own Excellent boundary — see match-tier.ts's own
 * header on why a bespoke cutoff here would be a fourth tier in disguise —
 * AND, as of docs/match-confidence-invariant.md, requires a real screenable-
 * tag denominator behind that tier before this alert type may fire at all.
 *
 * This is deliberately an ELIGIBILITY gate, not a display fix. `MatchTierBadge`
 * and the digest both handle a thin-denominator "excellent" by capping and
 * qualifying what they show — appropriate for a passive browsing surface,
 * where the honest, capped number still has a place in a list. This alert's
 * entire premise is different: §6.10's own copy tells the recipient "this one
 * is too strong to sit on" and "you'll only hear from me like this for
 * matches this strong" — an ESCALATION claim, not a label. A thin-denominator
 * match (per docs/stage8-match-accuracy.md, 65% of every "Excellent" this
 * system has ever computed) has no business making that claim regardless of
 * how honestly the number afterward gets capped, the same way Auto-Apply's
 * own gate (0164) excludes a thin match from its queue rather than just
 * labeling it honestly once queued. `explanation` is optional only so a
 * caller with genuinely nothing to give still degrades to the old,
 * tier-only behaviour rather than crashing — this module's own real flow
 * always has one, from `computeMatchScore`.
 */
export function isExcellentMatch(score: number, explanation?: unknown): boolean {
  if (getMatchTier(score) !== "excellent") return false;
  const screenableTagTotal = screenableTagTotalFromExplanation(explanation);
  if (screenableTagTotal !== null && isThinScreenableTagSet(screenableTagTotal)) return false;
  return true;
}

export interface ProactiveAlertCandidate {
  userId: string;
  email: string;
  firstName: string | null;
  /** False when the candidate has no base resume to score against — nothing
   * to compute a match from, so they are never eligible regardless of
   * activity or rate-limit state. */
  hasBaseResume: boolean;
  lastActiveAt: string | null;
  lastAlertSentAt: string | null;
}

/**
 * Whether this candidate may receive an alert AT ALL this run — independent
 * of whether any of this run's new postings actually score Excellent for
 * them. Pure, so the three real gates (resume exists, not actively
 * searching, not rate-limited) are each individually testable without a
 * database.
 */
export function candidateIsEligible(candidate: ProactiveAlertCandidate, now: Date): boolean {
  if (!candidate.hasBaseResume) return false;
  if (!isNotActivelySearching(candidate.lastActiveAt, now)) return false;
  if (isWithinRateLimit(candidate.lastAlertSentAt, now)) return false;
  return true;
}

export interface ScoredNewJob {
  jobId: string;
  title: string;
  companyName: string;
  location: string | null;
  score: number;
  /**
   * `computeMatchScore`'s own return value (src/lib/matching/score.ts),
   * carried through so `isExcellentMatch` above can apply the thin-match
   * gate and `describeMatchConfidence` (match-tier.ts) can cap what the
   * email/in-app template actually displays — one field now feeding both
   * mechanisms, per this module's own header on why they're separate.
   */
  explanation: MatchExplanation;
}

/**
 * Of this run's new postings scored against ONE eligible candidate, the one
 * job (if any) worth alerting them about — the single highest-scoring
 * Excellent match, never more than one. §6.10's own worked example is about
 * ONE exceptional match, not a list; sending someone three "exceptional"
 * matches in the same message would undercut the word.
 */
export function pickBestJobForCandidate(scoredJobs: ScoredNewJob[]): ScoredNewJob | null {
  const excellent = scoredJobs.filter((j) => isExcellentMatch(j.score, j.explanation));
  if (excellent.length === 0) return null;
  return excellent.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))[0];
}
