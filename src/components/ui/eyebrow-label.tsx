import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface EyebrowLabelProps extends HTMLAttributes<HTMLSpanElement> {
  /** "md" = marketing scale (12px), "sm" = app/dashboard scale (11px). */
  size?: "md" | "sm";
}

/**
 * The small-caps rust kicker used above every major section/card.
 * Must literally describe the content directly below it — no decorative
 * flourishes with no real referent (design handoff §6).
 */
export function EyebrowLabel({
  size = "md",
  className,
  ...props
}: EyebrowLabelProps) {
  return (
    <span
      className={cn(
        "font-body font-bold uppercase tracking-[0.14em] text-rust",
        size === "md" ? "text-[12px]" : "text-[11px]",
        className,
      )}
      {...props}
    />
  );
}
