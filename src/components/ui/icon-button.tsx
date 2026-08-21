"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
}

/**
 * Circular 40x40 icon-only button (Save/Share/notifications/…). Every
 * interactive element needs a real >=40px hit target, even the small ones —
 * this was a real shipped bug, not a hypothetical (design handoff §7).
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ className, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-line bg-transparent text-ink-soft transition-colors hover:border-rust hover:text-rust",
          className,
        )}
        {...props}
      />
    );
  },
);
