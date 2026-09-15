import type { MatchExplanation } from "@/lib/matching/score";

/**
 * Match-tier system — exactly three tiers, used everywhere a score appears.
 * Thresholds and color mapping are fixed by the design handoff doc; never add a
 * fourth tier or bespoke wording elsewhere in the app.
 */
export type MatchTier = "excellent" | "good" | "fair";

export const MATCH_TIER_LABEL: Record<MatchTier, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
};

/** Tailwind text-color utility for each tier (see globals.css @theme tokens). */
export const MATCH_TIER_TEXT_CLASS: Record<MatchTier, string> = {
  excellent: "text-green",
  good: "text-rust",
  fair: "text-amber",
};

export function getMatchTier(score: number): MatchTier {
  if (score >= 80) return "excellent";
  if (score >= 70) return "good";
  return "fair";
}

/**
 * The same three boundaries, with a floor — for DISPLAY ONLY. A 50% score
 * rendered "Fair" the same as a 69% (confirmed live), and CLAUDE.md's own
 * "~60-69%" for Fair implies a floor that never existed in `getMatchTier`.
 *
 * NOT a change to `getMatchTier` itself, deliberately. `match_scores.tier`
 * (migration 0000) is `text not null`, and `getMatchTier`'s result is what
 * `compute-and-store.ts` writes straight into it — returning `null` there
 * would either violate that constraint (silently: `persistMatchScores` logs
 * write errors rather than throwing, so a whole feed's worth of sub-60 cards
 * would just stop caching, with nothing visible pointing at why) or need a
 * schema migration, which this change has no reason to carry. `getMatchTier`
 * also feeds `digest/select.ts`, which pre-filters to `score >= 70` before
 * ever calling it — the digest structurally never sees a sub-60 (or even
 * sub-70) tier, so it has no floor to gain and no null to newly handle.
 *
 * This is the function every RENDER site should call instead:
 * `match-tier-badge.tsx` is the only one that needs to, since job-card.tsx,
 * jobs/[id]/page.tsx, the marketing demo components and the Auto-Apply queue
 * item all render a score through it rather than calling a tier function
 * themselves. `job-board-preview.tsx` renders hardcoded marketing sample data
 * (63/78/92) with no sub-60 value, so it has nothing to change either.
 */
export function getDisplayMatchTier(score: number): MatchTier | null {
  if (score < 60) return null;
  return getMatchTier(score);
}

/**
 * Stage 8 continued, 2026-09-06 — a real, founder-reported production case:
 * a Product Manager resume (FinTech/HealthTech, no research background)
 * scored "99% · Excellent" against a Global MEL Manager/Senior Manager
 * posting (One Acre Fund) whose ONLY screenable tag, after
 * `NON_SCREENABLE_SKILLS` filtering, was "project management" — a generic
 * term almost every resume has. The job's actual differentiating
 * requirements (RCTs, Stata, R, survey design) were never extracted into
 * `structured_jd.skills`, so `computeMatchScore` never saw them; a separate
 * LLM-backed code path (the Tailor flow, which reads the full JD prose)
 * scored the same pairing 68% with six genuine gaps. Two live numbers, 31
 * points apart, for the same pairing — and the card showing the wrong one
 * was the one shown *before* a candidate decides whether to apply.
 *
 * Measured on production (nytwbbzfpytctjsoczzq), 2026-09-06: of every
 * `match_scores` row ever computed with tier = 'excellent', 65% sit on a
 * posting whose screenable-tag denominator is 1 or fewer, and 89% sit at 2
 * or fewer — an "Excellent" rating on this board is, right now, overwhelmingly
 * an artifact of a thin denominator rather than evidence of broad domain fit.
 *
 * `match-breakdown.tsx` already calls a denominator this size "thin" in its
 * own sub-score line (`skillCoverageSub`) — this is that same threshold,
 * shared rather than duplicated, so the topline tier label and the sub-score
 * line underneath it can never disagree about what counts as thin. Anything
 * that renders BOTH `MatchTierBadge` and `MatchBreakdown` for the same score
 * must use this function, not its own cutoff.
 *
 * NOT a change to `getMatchTier`/`getDisplayMatchTier`/`match_scores.tier`:
 * the stored tier, the Auto-Apply threshold and the digest's Good+ filter are
 * all untouched. This only tells a RENDER site whether the Excellent label it
 * is about to show needs qualifying — see `MatchTierBadge`'s own use of it.
 */
export const THIN_SCREENABLE_TAG_MAX = 2;

export function isThinScreenableTagSet(totalScreenableTags: number): boolean {
  return totalScreenableTags <= THIN_SCREENABLE_TAG_MAX;
}

/**
 * Stage 8 continued again, 2026-09-08 — the sibling case the thin-denominator
 * fix above doesn't reach: a posting with ZERO screenable tags. `score.ts`'s
 * `computeMatchScore` gives that a neutral `skillCoverage = 0.5` (35-55 after
 * seniority adjustment) "rather than a false 0 or 100" — reasonable for the
 * STORED score in isolation, but that number then competes in Recommended/
 * External/Saved's sort against postings where something was actually
 * measured, however thin. Measured against real production `match_scores`
 * (docs/zero-skill-scoring.md): every user with scores shows zero-tag
 * postings averaging rank ~5-34 out of their board, while genuinely measured
 * partial matches average rank 100-190+ — "we cannot tell" outranking "we
 * checked, and it's weak." A zero-tag posting also always scores below 60
 * (max 55), so `getDisplayMatchTier` already returns `null` for it — there is
 * no tier word for a qualifier to suffix, which is why this is its own
 * predicate rather than folded into `isThinScreenableTagSet`.
 *
 * Used in exactly three places, the same way `isThinScreenableTagSet` keeps
 * `MatchTierBadge` and `match-breakdown.tsx` from disagreeing about what
 * counts as thin: the sort partition in `jobs/page.tsx`'s three score-based
 * tab branches, `MatchTierBadge`'s "Unscreened" qualifier, and
 * `match-breakdown.tsx`'s existing "no screenable skills listed" line.
 */
export function hasNoScreenableSkills(totalScreenableTags: number): boolean {
  return totalScreenableTags === 0;
}

/**
 * Sort helper for the partition above: unscreened postings sort AFTER every
 * measured one (however thin), never mixed in by raw score. `baseComparison`
 * is whatever the tab's own comparator already produced for `a`/`b` — this
 * only overrides that result when exactly one side is unscreened; when both
 * (or neither) are, the tab's own ordering decides, unchanged.
 *
 * A partition, not a removal — see docs/zero-skill-scoring.md for why:
 * removing zero-tag postings from the feed risks hiding a real opportunity
 * behind an extraction gap, not a genuinely bad match.
 */
export function screenedFirstCompare(
  aUnscreened: boolean,
  bUnscreened: boolean,
  baseComparison: number,
): number {
  if (aUnscreened !== bUnscreened) return aUnscreened ? 1 : -1;
  return baseComparison;
}

/**
 * Stage 12: two consecutive "100% · Excellent" cards on the same feed load
 * (observed live) reads as the product overclaiming — a skill-overlap score
 * cannot support the certainty "100%" implies. Display-only: this never
 * touches the stored score, the tier boundaries above, Auto-Apply's
 * threshold, or anything the scoring algorithm itself does (that's Stage 8).
 * Only ever changes a value that was already >= 99 — every other score
 * renders exactly as computed.
 */
export function displayMatchScore(score: number): number {
  return Math.min(score, 99);
}

/**
 * Stage 8 continued yet again — the qualifier suffix ("Excellent — thin
 * match") turned out not to be enough on its own: real recruiter feedback on
 * the One Acre Fund / Global MEL Manager case confirmed the qualifier fires
 * correctly, but it's small italic text sitting next to a giant, confidently
 * green 99%. The headline number and color still say "Excellent" at a
 * glance, and that's the part that overclaims — the qualifier text was never
 * the problem.
 *
 * This caps what gets DISPLAYED (never the stored score, never
 * `computeMatchScore`, never `match_scores.tier`) to just under the
 * Excellent floor whenever `isThinScreenableTagSet` says the denominator
 * backing an "excellent" tier is too thin to support it. The capped number
 * then gets its tier RE-DERIVED from `getMatchTier` — landing naturally on
 * "Good" at 79 — rather than inventing any bespoke fourth label or color.
 * The three-tier system stays exactly three tiers.
 *
 * Deliberately a different number from `THIN_SCREENABLE_TAG_MAX` above: that
 * one decides WHETHER a screenable-tag count counts as thin at all; this one
 * decides how far to cap the display score once it does. Two different
 * numbers doing two different jobs — don't conflate them.
 */
export const THIN_MATCH_DISPLAY_CEILING = 79;

export function capThinMatchDisplayScore(displayScore: number): number {
  return Math.min(displayScore, THIN_MATCH_DISPLAY_CEILING);
}

/**
 * Tolerant extraction of a screenable-tag total from whatever shape a
 * `match_scores.explanation` value actually arrives in.
 *
 * Two real shapes reach this: a `MatchExplanation` object still in-process
 * from `computeMatchScore`'s own return value (fully trustworthy — its
 * `matchedSkills`/`missingSkills` are always real arrays), and a value read
 * back off Supabase's untyped `Json` column (trustworthy in practice today,
 * but not something the type system can promise). `Array.isArray` guards
 * make this safe either way rather than assuming the column round-trips
 * exactly. `null`/`undefined` means "no explanation available to this
 * caller" — the marketing demo's hardcoded sample scores and the dev
 * design-check page have nothing to give — and returns `null`, distinct from
 * a genuine zero-tag explanation (`hasNoScreenableSkills`'s own case), which
 * returns `0`. Collapsing those two into the same value is exactly the kind
 * of thing that made this worth a shared function in the first place: a
 * caller with real data and a caller with none must not render identically.
 */
export function screenableTagTotalFromExplanation(explanation: unknown): number | null {
  if (explanation === null || explanation === undefined) return null;
  const e = explanation as Partial<MatchExplanation>;
  const matched = Array.isArray(e.matchedSkills) ? e.matchedSkills.length : 0;
  const missing = Array.isArray(e.missingSkills) ? e.missingSkills.length : 0;
  return matched + missing;
}

export interface MatchConfidenceDescription {
  /** The number to print next to a "%" sign — Stage 12's 99-cap always
   * applied, and Stage 8's thin-match cap applied on top of that when the
   * tier is a thin-denominator "excellent". */
  displayScore: number;
  /** The tier this description actually renders as, after any thin-match
   * re-tiering — never a bespoke fourth tier. `null` below the display floor
   * (`getDisplayMatchTier`'s own 60 floor) and no screenable data to justify
   * an "Unscreened" label either. */
  tier: MatchTier | null;
  /** The exact word(s) to render next to the score, or `null` when there is
   * nothing honest to say (sub-60, no explanation). Never build a label by
   * hand from `tier` elsewhere — this is the one place `MATCH_TIER_LABEL` is
   * looked up for a render site. */
  label: string | null;
  /** True when this is a thin-tag "excellent" that got capped and re-tiered
   * — the qualifier is already folded into `label`; exposed separately so a
   * caller can add its own "why" copy (a footnote, a tooltip) if it wants to. */
  isThin: boolean;
  /** True for a genuine zero-screenable-tag score — `label` is "Unscreened"
   * in this case, never a tier word. */
  isUnscreened: boolean;
}

/**
 * THE single source of truth for "what may this render site say about a
 * match score" — factored out of `MatchTierBadge` so every other renderer
 * (the weekly digest email, the proactive "exceptional match" alert, and
 * whatever ships next) calls the exact same function rather than keeping its
 * own copy of this logic to drift out of sync with. See
 * docs/match-confidence-invariant.md for the standing rule this exists to
 * enforce and `tests/lib/match-confidence-enforcement.test.ts` for the check
 * that a new render site did not forget to call it.
 *
 * Pure — no React, no DOM, safe to call from an email-template module that
 * has neither.
 */
export function describeMatchConfidence(
  score: number,
  explanation?: unknown,
): MatchConfidenceDescription {
  const tier = getDisplayMatchTier(score);
  const screenableTagTotal = screenableTagTotalFromExplanation(explanation);
  const isThin =
    tier === "excellent" && screenableTagTotal !== null && isThinScreenableTagSet(screenableTagTotal);
  const isUnscreened = screenableTagTotal !== null && hasNoScreenableSkills(screenableTagTotal);

  const rawDisplayScore = displayMatchScore(score);
  const displayScore = isThin ? capThinMatchDisplayScore(rawDisplayScore) : rawDisplayScore;
  const effectiveTier = isThin ? getMatchTier(displayScore) : tier;

  const label = effectiveTier
    ? isThin
      ? `${MATCH_TIER_LABEL[effectiveTier]} — thin match`
      : MATCH_TIER_LABEL[effectiveTier]
    : isUnscreened
      ? "Unscreened"
      : null;

  return { displayScore, tier: effectiveTier, label, isThin, isUnscreened };
}
