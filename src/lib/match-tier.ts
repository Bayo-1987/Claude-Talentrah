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
