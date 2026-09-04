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
