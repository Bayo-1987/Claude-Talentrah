import { describeMatchConfidence, type MatchTier } from "@/lib/match-tier";
import type { MatchExplanation } from "@/lib/matching/score";

const VALID_TIERS: readonly MatchTier[] = ["excellent", "good", "fair"];

export type ScreeningFilter = "passed" | "failed" | undefined;

export interface ApplicantFilterState {
  /** Selected tier chips. Empty = every tier passes (no tier filter active). */
  tiers: MatchTier[];
  /** `true` when the "Unscored" toggle is set to hide rather than include. */
  hideUnscored: boolean;
  /**
   * A THIRD state, deliberately not a boolean: `undefined` (not
   * set) must stay distinguishable from "show only failed", the same
   * three-way care `applications.screening_passed` itself already takes
   * (0171's own header). Unset keeps every row, including `screeningPassed
   * === null` ones (no screening questions, or an incomplete
   * self-assessment) — the same "don't manufacture a claim" instinct.
   */
  screening: ScreeningFilter;
}

/**
 * `?tier=excellent,good&unscored=hide&screening=passed` → filter state.
 * Unknown/garbled tier values are dropped rather than treated as a
 * match-nothing filter — the jobs feed's own `workType`/`seniority` parsing
 * takes the same stance on a malformed query string. A `screening` value
 * outside "passed"/"failed" is treated the same way: dropped back to unset.
 */
export function parseApplicantFilterParams(searchParams: {
  tier?: string;
  unscored?: string;
  screening?: string;
}): ApplicantFilterState {
  const tiers = (searchParams.tier ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t): t is MatchTier => (VALID_TIERS as readonly string[]).includes(t));
  const screening: ScreeningFilter =
    searchParams.screening === "passed" || searchParams.screening === "failed"
      ? searchParams.screening
      : undefined;
  return { tiers, hideUnscored: searchParams.unscored === "hide", screening };
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
 * Tier, "unscored", and "screening" are three INDEPENDENT axes, not one
 * combined filter: an unscored applicant is governed ONLY by
 * `hideUnscored`, never by which tier chips are active (there is no tier to
 * match against); a scored applicant is governed ONLY by `tiers`; and
 * `screening` is governed ONLY by the row's own `screeningPassed` value,
 * unrelated to either. Selecting "Excellent" never hides an unscored
 * applicant, the unscored toggle never hides a scored one, and neither
 * touches the screening filter at all.
 *
 * `screening: "passed"` keeps only `screeningPassed === true` rows;
 * `"failed"` keeps only `screeningPassed === false`; unset (`undefined`)
 * keeps EVERY row, including `null` ones (no screening questions, or an
 * incomplete self-assessment) — the same "don't manufacture a claim"
 * instinct 0171's own three-valued design already uses. A `null` row never
 * matches "passed" or "failed" — it is neither.
 */
export function applicantMatchesFilter(
  matchScore: number | null,
  effectiveTier: MatchTier | null,
  { tiers, hideUnscored, screening }: ApplicantFilterState,
  screeningPassed: boolean | null,
): boolean {
  if (screening === "passed" && screeningPassed !== true) return false;
  if (screening === "failed" && screeningPassed !== false) return false;

  if (matchScore === null) return !hideUnscored;
  if (tiers.length === 0) return true;
  return effectiveTier !== null && tiers.includes(effectiveTier);
}
