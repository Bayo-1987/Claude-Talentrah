"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { buttonClasses, type ButtonVariant, type ButtonSize } from "@/lib/button-classes";

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

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "primary", size = "md", className, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={buttonClasses(variant, size, className)}
        {...props}
      />
    );
  },
);
