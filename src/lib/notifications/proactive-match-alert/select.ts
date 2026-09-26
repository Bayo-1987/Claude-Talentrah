import { getMatchTier, isThinScreenableTagSet, screenableTagTotalFromExplanation } from "@/lib/match-tier";
import type { MatchExplanation } from "@/lib/matching/score";

/**
 * send-138 — Farah's proactive "exceptional match, even if you're not
 * looking" alert (build-prompt §6.10's own worked example).
 *
 * ── "NOT ACTIVELY SEARCHING", DEFINED (CORRECTED, send-467) ────────────────
 *
 * A user counts as not actively searching when `profiles.last_active_at`
 * (0195) is older than `NOT_ACTIVELY_SEARCHING_DAYS` — or is null, meaning
 * they have never registered a real visit since that column existed.
 *
 * THIS USED TO READ `match_scores.computed_at` INSTEAD, AND THAT WAS WRONG —
 * stated here rather than quietly dropped, because the reasoning that
 * justified it is exactly the reasoning that broke it one day later.
 * `computed_at` was chosen because it "updates on every real feed/job-detail
 * visit ... because that is precisely when this app recomputes it" — true
 * the day this file shipped (send-138), and false again the moment
 * `src/lib/matching/refresh-job.ts`'s daily `refresh-match-scores` cron
 * shipped (send-138+1): that job ALSO writes `computed_at = now()`, for
 * EVERY user with a base resume, whenever a new eligible posting appears
 * they have not been scored against yet. Given continuous ingestion, a
 * genuinely dormant user's `computed_at` keeps getting re-touched by the
 * background job on a near-daily cadence — indistinguishable from a real
 * visit. Confirmed against production before this fix (send-467): of every
 * user with a `match_scores` row, the single oldest `computed_at` was 16
 * days and every other one was under 8; four users shared a `computed_at`
 * within 34 seconds of each other, the signature of the refresh job's own
 * per-user loop, not four independent visits. Zero proactive match alerts
 * had ever been sent in production — this gate was, in effect, permanently
 * closed for anyone with a base resume the moment the background job had
 * touched them once.
 *
 * `last_active_at` fixes this the structural way, not the conventional way:
 * it is stamped ONLY by `touch_last_active()` (0195), a SECURITY DEFINER
 * function scoped to `auth.uid()` with EXECUTE granted to `authenticated`
 * ONLY — never `service_role`, so `refresh-job.ts` and every other
 * background job in this codebase has no privilege that lets it write this
 * column, by construction, not by a rule someone has to remember. See
 * 0195's own migration header for the full account, including how a live
 * check caught `service_role` retaining EXECUTE via Supabase's own default
 * per-schema grant even after `revoke ... from public` — the exact same
 * "table grant overrides a narrower revoke" trap CLAUDE.md documents for
 * tables, on a function instead.
 *
 * 14 DAYS, not the digest's own 7: the digest's cadence is "everyone still
 * opted in, every week" — a much lower bar than "has this person drifted
 * away". Two weeks of no real visit is long enough that a genuinely active
 * seeker (visiting even sporadically) never qualifies, short enough that a
 * real dormant user is caught within one or two ingest cycles of drifting
 * past it. Unchanged by this fix — only the underlying signal was wrong.
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

/** `lastActiveAt` is `profiles.last_active_at` (0195) — stamped only by a
 * real authenticated page view, never by a background job — or null if this
 * user has never registered one, which counts as "not actively searching"
 * (nothing to the contrary), not as an exclusion. Do NOT feed this
 * `match_scores.computed_at`: send.ts used to, and that was the send-467 bug
 * — see this file's own header for the full account. */
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
  /** `profiles.last_active_at` (0195) — see `isNotActivelySearching`'s own
   * doc for why this is no longer `match_scores.computed_at`. */
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
