import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Renamed from Editorial's BorderedCard (send-197/Sunbird swap). That name
 * described a convention — 1.5–2px ink border, no radius — that no longer
 * applies: Sunbird cards separate from the page with a rounded corner and a
 * soft shadow, not a hairline border. Keeping the old name would have kept
 * describing a look the component no longer produces.
 */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * On by default — Sunbird gives every card its soft shadow (design
   * handoff §"Components"), the opposite of Editorial's BorderedCard, which
   * reserved a shadow for exactly one element (the hero submit box). Set
   * false for a card nested inside another shadowed surface, where two
   * stacked shadows would just look like a heavier, muddier one.
   */
  shadow?: boolean;
}

export function Card({ shadow = true, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-card",
        shadow && "shadow-[0_4px_16px_oklch(30%_0.05_35_/_0.08)]",
        className,
      )}
      {...props}
    />
  );
}
