import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface BorderedCardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The hero submit box is the ONLY element in the whole system that gets a
   * shadow — don't set this true anywhere else (design handoff §1/§4).
   */
  shadow?: boolean;
  borderWidth?: "1.5" | "2";
}

export function BorderedCard({
  shadow = false,
  borderWidth = "1.5",
  className,
  ...props
}: BorderedCardProps) {
  return (
    <div
      className={cn(
        "rounded-none bg-card",
        borderWidth === "1.5" ? "border-[1.5px]" : "border-2",
        "border-ink",
        shadow && "shadow-[0_24px_48px_-28px_oklch(20%_0.018_50_/_0.3)]",
        className,
      )}
      {...props}
    />
  );
}
