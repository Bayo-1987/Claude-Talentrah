import {
  MATCH_TIER_LABEL,
  MATCH_TIER_TEXT_CLASS,
  getDisplayMatchTier,
  displayMatchScore,
} from "@/lib/match-tier";
import { cn } from "@/lib/cn";

export interface MatchTierBadgeProps {
  score: number;
  /**
   * "eyebrow" = dashboard job card style ("92% · Excellent", small caps).
   * "display" = landing hero/classifieds style (large serif %, italic tier word).
   */
  variant?: "eyebrow" | "display";
  className?: string;
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
}: MatchTierBadgeProps) {
  const tier = getDisplayMatchTier(score);
  const colorClass = tier ? MATCH_TIER_TEXT_CLASS[tier] : "text-ink-soft";
  const label = tier ? MATCH_TIER_LABEL[tier] : null;
  const displayScore = displayMatchScore(score);

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
    </span>
  );
}
