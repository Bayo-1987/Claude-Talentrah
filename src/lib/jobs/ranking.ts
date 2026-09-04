/**
 * Recommended-tab ranking decay — Stage 12.
 *
 * The flagship tab ignored freshness entirely: a Moniepoint role posted 4
 * weeks ago at 100% would always outrank a role posted today at 75%, because
 * Recommended sorted purely on match_scores.score. That is backwards for a
 * product whose whole freshness thesis (src/lib/jobs/freshness.ts) is that a
 * 30-day-old listing is barely worth showing at all.
 *
 * The fix is a bounded LINEAR penalty against posted_at, applied only to the
 * ranking key — the real score (what's stored, what's shown, what feeds
 * Auto-Apply's threshold) is untouched. Bounded and linear rather than
 * exponential: predictable, easy to reason about at the edges (age 0 => no
 * penalty; age >= the freshness floor => the full penalty, never more), and
 * cheap to explain in one sentence. A posting older than
 * JOB_FRESHNESS_WINDOW_DAYS is never scored at all — it was excluded from
 * `jobs` upstream by the ambient floor before this function ever sees it —
 * so decay cannot "resurrect" anything past that boundary; it can only
 * re-order what already survived it.
 *
 * RECOMMENDED ONLY. Most Recent (`tab === "recent"`) sorts purely by
 * posted_at in jobs/page.tsx and never calls this — decay answers "what's
 * the best match right now", which is a different question from "what's
 * newest", and the two tabs must keep answering different questions.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Total points a fully-aged (30-day-old) posting loses relative to a
 * brand-new one. Chosen against the actual reported scenario: a Moniepoint
 * role at 100% posted 4 weeks (28 days) ago must lose in Recommended to a
 * fresh 75% — 100 - (28/30 * 30) = 72 < 75. 30 also keeps a very low fresh
 * score from beating a very high stale one outright: a fresh 50% still
 * loses to a 30-day-old 90% (90 - 30 = 60 > 50).
 */
const RECOMMENDED_DECAY_MAX_POINTS = 30;

export function recommendedRankingKey(
  score: number,
  postedAt: string,
  freshnessWindowDays: number,
  now: number = Date.now(),
): number {
  const ageDays = (now - new Date(postedAt).getTime()) / DAY_MS;
  // Clamped on both ends: a future posted_at (clock skew) must not grant a
  // bonus, and anything at or past the floor takes the full, not a larger,
  // penalty — belt-and-suspenders on top of the floor already excluding it.
  const clampedAgeDays = Math.min(Math.max(ageDays, 0), freshnessWindowDays);
  const penalty = (clampedAgeDays / freshnessWindowDays) * RECOMMENDED_DECAY_MAX_POINTS;
  return score - penalty;
}
