import {
  MATCH_TIER_LABEL,
  MATCH_TIER_TEXT_CLASS,
  getDisplayMatchTier,
  displayMatchScore,
  isThinScreenableTagSet,
} from "@/lib/match-tier";
import { cn } from "@/lib/cn";
import type { MatchExplanation } from "@/lib/matching/score";

export interface MatchTierBadgeProps {
  score: number;
  /**
   * "eyebrow" = dashboard job card style ("92% · Excellent", small caps).
   * "display" = landing hero/classifieds style (large serif %, italic tier word).
   */
  variant?: "eyebrow" | "display";
  className?: string;
  /**
   * Stage 8 continued, 2026-09-06: same `MatchExplanation` the card's
   * `MatchBreakdown` already renders. Optional — every caller with a real,
   * scored job/resume pairing has this on hand (see job-card.tsx and
   * jobs/[id]/page.tsx); the marketing demo's hardcoded sample scores and the
   * dev design-check page have no explanation to give and render exactly as
   * before. When present and the tier is "excellent", a thin screenable-tag
   * denominator (`isThinScreenableTagSet`, match-tier.ts) qualifies the label
   * instead of showing an unqualified "Excellent" next to a sub-score line
   * that already says "thin" — see match-tier.ts's own header for the real
   * production case this fixes.
   */
  explanation?: MatchExplanation;
  /**
   * A capped-to-99 score (`displayMatchScore`, Stage 12) gets a small,
   * secondary marker showing the real value on hover — for review-before-
   * submit contexts (Auto-Apply's queue) where the raw number is the thing
   * being acted on, not just glanced at. Defaults to false everywhere else,
   * including the job card's own main line: this never adds a second
   * percentage next to the one already shown, only a quiet annotation on it,
   * and it changes nothing about `displayMatchScore` or the 99 cap itself.
   */
  showRawWhenCapped?: boolean;
}

/**
 * Below 60 there is no tier — see `getDisplayMatchTier`'s own comment for why
 * that's a display-only floor rather than a change to the stored tier. Never
 * a fourth colored label: the bare percentage renders in neutral `ink-soft`,
 * no tier word, no tier color.
 */
export function MatchTierBadge({
  score,
  variant = "eyebrow",
  className,
  explanation,
  showRawWhenCapped = false,
}: MatchTierBadgeProps) {
  const tier = getDisplayMatchTier(score);
  const colorClass = tier ? MATCH_TIER_TEXT_CLASS[tier] : "text-ink-soft";
  const screenableTagTotal = explanation
    ? explanation.matchedSkills.length + explanation.missingSkills.length
    : null;
  const isThin =
    tier === "excellent" && screenableTagTotal !== null && isThinScreenableTagSet(screenableTagTotal);
  const label = tier ? (isThin ? `${MATCH_TIER_LABEL[tier]} — thin match` : MATCH_TIER_LABEL[tier]) : null;
  const displayScore = displayMatchScore(score);
  const isCapped = showRawWhenCapped && score > 99;

  if (variant === "display") {
    return (
      <div className={cn("flex items-baseline gap-3", className)}>
        <span className="font-display text-[46px] leading-none text-ink">
          {displayScore}
          <span className="text-[20px]">%</span>
        </span>
        {label && (
          <span
            className={cn(
              "font-display text-[13px] font-bold italic",
              colorClass,
            )}
          >
            {label}
          </span>
        )}
      </div>
    );
  }

  return (
    <span
      className={cn(
        "font-body text-[11px] font-bold uppercase tracking-[0.14em]",
        colorClass,
        className,
      )}
    >
      {label ? `${displayScore}% · ${label}` : `${displayScore}%`}
      {isCapped && (
        <span
          className="ml-1 normal-case tracking-normal text-ink-soft/70"
          title={`Uncapped match score: ${score}%`}
        >
          *
        </span>
      )}
    </span>
  );
}
