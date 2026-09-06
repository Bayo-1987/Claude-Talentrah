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
