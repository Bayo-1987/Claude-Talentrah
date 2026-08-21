"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "text";
type ButtonSize = "md" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /**
   * "md" = marketing-site scale (Main-Editorial.dc.html), "sm" = app/dashboard
   * scale (JobFeed-Editorial.dc.html). Only primary/secondary/ghost at "md" and
   * primary/text at "sm" are pixel-sourced from the reference files; other
   * combinations are a reasonable extrapolation — check against a real screen
   * before treating them as final.
   */
  size?: ButtonSize;
}

const base =
  "inline-flex items-center justify-center rounded-none font-body font-semibold transition-colors";

const variantSizeClasses: Record<ButtonSize, Record<ButtonVariant, string>> = {
  md: {
    primary:
      "bg-ink text-paper border-none min-h-[48px] px-[30px] py-[15px] text-[15px] hover:bg-rust",
    secondary:
      "bg-transparent text-ink border-[1.5px] border-ink min-h-[44px] px-[28px] py-[13px] text-[15px] hover:border-rust hover:text-rust",
    ghost:
      "bg-transparent text-ink border-none min-h-[44px] px-[6px] py-[10px] text-[15px] hover:text-rust",
    text: "bg-transparent text-ink-soft border-none min-h-[44px] px-[2px] py-[10px] text-[13.5px] underline underline-offset-3 hover:text-rust",
  },
  sm: {
    primary:
      "bg-ink text-paper border-none min-h-[40px] px-[18px] py-[10px] text-[13.5px] hover:bg-rust",
    secondary:
      "bg-transparent text-ink border border-line min-h-[40px] px-[16px] py-[10px] text-[13px] hover:border-rust hover:text-rust",
    ghost:
      "bg-transparent text-ink-soft border-none min-h-[40px] px-[4px] py-[8px] text-[13px] hover:text-rust",
    text: "bg-transparent text-ink-soft border-none min-h-[40px] px-[2px] py-[8px] text-[13px] underline underline-offset-2 hover:text-rust",
  },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "primary", size = "md", className, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={cn(base, variantSizeClasses[size][variant], className)}
        {...props}
      />
    );
  },
);
