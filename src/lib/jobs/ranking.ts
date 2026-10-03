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
import { describeMatchConfidence, getDisplayMatchTier, hasNoScreenableSkills, isThinScreenableTagSet } from "@/lib/match-tier";
import type { ScoredJob } from "@/lib/matching/compute-and-store";

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

/**
 * The feed's tab-specific sort — Recommended/External/Saved by match score
 * (with unscreened postings partitioned last, see `screenedFirstCompare`),
 * Most Recent untouched here (it sorts by `posted_at` before this ever runs).
 *
 * A REAL SEARCH TERM SKIPS THIS ENTIRELY, on every tab. `search_job_postings`
 * (0100, corrected 0108) already returns its results in a deliberate order —
 * `ts_rank(...) desc, posted_at desc`, a weighted full-text rank where a
 * title/skill/company hit always outranks an incidental body-text mention,
 * with recency (never score) as the RPC's own tiebreak. `scoreJobs` is a
 * plain `.map()` over that array, so `scored` still holds the RPC's exact
 * order when this is called. Re-sorting by match score here — every branch
 * below did, unconditionally, until this fix — throws that ranking away:
 * confirmed live on production, searching "engineer" surfaced a 99%-match
 * "IT Administrator" (the word appears nowhere in its title, company, or
 * skill tags) ahead of "Senior Backend Engineer" and "Data Engineer", which
 * were buried dozens of rows down under an unrelated similarity score. Most
 * Recent was the one tab this never hit — not because search was designed to
 * behave differently there, but because its branch condition already
 * excludes it from this function's caller; mirroring that exemption
 * deliberately on every tab, rather than leaving it as an accident of one
 * tab's own sort condition, is the point of the `hasSearchTerm` check below.
 *
 * No score-based tiebreak survives a search either, even among results the
 * RPC ranks equally: the RPC's own tiebreak choice (recency) is the only
 * existing precedent, and "equally-relevant text matches ordered by resume
 * fit" would be a new design decision this function does not make on its own.
 */
export function sortFeedResults(
  scored: ScoredJob[],
  tab: string,
  hasSearchTerm: boolean,
  freshnessWindowDays: number,
): void {
  if (hasSearchTerm) return;
  if (tab === "recent") return;
  // Recommended carries the freshness penalty; External and Saved order by the same bands without it.
  const decay = tab === "recommended";
  scored.sort((a, b) => compareByBandThenEvidence(a, b, decay ? freshnessWindowDays : null));
}

/**
 * The feed's match ordering (S3-24, corrected by S3-51): displayed TIER, then evidence, then the DISPLAYED score, then tag count.
 *
 * It used to sort by the RAW score. A thin match (1-2 screenable tags) scores a raw 100 whenever the resume covers its
 * one or two generic tags and DISPLAYS as 79 because of the thin cap, but sorted by the 100, so eight of them floated
 * above the only well-evidenced jobs. "Thin" means less confident, so it must rank lower, not higher.
 *
 *   1. the tier the BADGE shows (`getDisplayMatchTier`, the one source of truth): Excellent (80+) < Good (70-79) < Fair (60-69)
 *      < no tier (under 60) < unscreened (no tags) last. A higher tier never sorts below a lower one, whatever the evidence
 *      or the freshness: the order must agree with the label the reader sees (S3-51: a 67% Fair with three tags sat above six
 *      79% Good matches because this band used to be "60-79", which merged Fair into Good);
 *   2. inside a tier, well-evidenced (3+ screenable tags) before thin (1-2);
 *   3. the displayed (capped) score, minus the Recommended freshness penalty;
 *   4. more screenable tags first, as the tie-break.
 */
interface RankFacts {
  band: number;
  thin: boolean;
  tags: number;
  display: number;
}

function rankFacts(s: ScoredJob): RankFacts {
  const tags = s.explanation.matchedSkills.length + s.explanation.missingSkills.length;
  const display = describeMatchConfidence(s.score, s.explanation).displayScore;
  const tier = getDisplayMatchTier(display);
  const band = hasNoScreenableSkills(tags) ? 4 : tier === "excellent" ? 0 : tier === "good" ? 1 : tier === "fair" ? 2 : 3;
  return { band, thin: isThinScreenableTagSet(tags), tags, display };
}

function compareByBandThenEvidence(a: ScoredJob, b: ScoredJob, freshnessWindowDays: number | null): number {
  const fa = rankFacts(a);
  const fb = rankFacts(b);
  if (fa.band !== fb.band) return fa.band - fb.band;
  if (fa.thin !== fb.thin) return fa.thin ? 1 : -1;
  const keyOf = (f: RankFacts, s: ScoredJob) =>
    freshnessWindowDays === null ? f.display : recommendedRankingKey(f.display, s.job.posted_at, freshnessWindowDays);
  const byScore = keyOf(fb, b) - keyOf(fa, a);
  if (byScore !== 0) return byScore;
  return fb.tags - fa.tags;
}
