import {
  MATCH_TIER_LABEL,
  MATCH_TIER_TEXT_CLASS,
  getMatchTier,
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

export function MatchTierBadge({
  score,
  variant = "eyebrow",
  className,
}: MatchTierBadgeProps) {
  const tier = getMatchTier(score);
  const colorClass = MATCH_TIER_TEXT_CLASS[tier];
  const label = MATCH_TIER_LABEL[tier];

  if (variant === "display") {
    return (
      <div className={cn("flex items-baseline gap-3", className)}>
        <span className="font-display text-[46px] leading-none text-ink">
          {score}
          <span className="text-[20px]">%</span>
        </span>
        <span
          className={cn(
            "font-display text-[13px] font-bold italic",
            colorClass,
          )}
        >
          {label}
        </span>
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
      {score}% · {label}
    </span>
  );
}
