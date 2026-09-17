import { describeMatchConfidence, type MatchTier } from "@/lib/match-tier";
import type { MatchExplanation } from "@/lib/matching/score";

const VALID_TIERS: readonly MatchTier[] = ["excellent", "good", "fair"];

export interface ApplicantFilterState {
  /** Selected tier chips. Empty = every tier passes (no tier filter active). */
  tiers: MatchTier[];
  /** `true` when the "Unscored" toggle is set to hide rather than include. */
  hideUnscored: boolean;
}

/**
 * `?tier=excellent,good&unscored=hide` → filter state. Unknown/garbled tier
 * values are dropped rather than treated as a match-nothing filter — the
 * jobs feed's own `workType`/`seniority` parsing takes the same stance on a
 * malformed query string.
 */
export function parseApplicantFilterParams(searchParams: {
  tier?: string;
  unscored?: string;
}): ApplicantFilterState {
  const tiers = (searchParams.tier ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t): t is MatchTier => (VALID_TIERS as readonly string[]).includes(t));
  return { tiers, hideUnscored: searchParams.unscored === "hide" };
}

/**
 * The tier a recruiter actually SEES on this applicant's badge — not a raw
 * `getMatchTier(score)` cutoff. `describeMatchConfidence` (match-tier.ts) can
 * downgrade a thin-denominator "Excellent" to "Good" for display
 * (docs/match-confidence-invariant.md's own rule: no consumer may present
 * more confidence than the screenable-tag denominator supports). Filtering
 * by the pre-downgrade tier would let "Excellent" mean two different things
 * on the same page — the chip and the badge MUST agree.
 */
export function effectiveTierFor(
  matchScore: number | null,
  explanation: MatchExplanation | null,
): MatchTier | null {
  if (matchScore === null) return null;
  return describeMatchConfidence(matchScore, explanation ?? undefined).tier;
}

/**
 * Tier and "unscored" are independent axes, not one combined filter:
 * an unscored applicant is governed ONLY by `hideUnscored`, never by which
 * tier chips are active (there is no tier to match against), and a scored
 * applicant is governed ONLY by `tiers` — selecting "Excellent" never hides
 * an unscored applicant, and the unscored toggle never hides a scored one.
 */
export function applicantMatchesFilter(
  matchScore: number | null,
  effectiveTier: MatchTier | null,
  { tiers, hideUnscored }: ApplicantFilterState,
): boolean {
  if (matchScore === null) return !hideUnscored;
  if (tiers.length === 0) return true;
  return effectiveTier !== null && tiers.includes(effectiveTier);
}
