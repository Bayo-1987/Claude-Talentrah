"use client";

import { forwardRef } from "react";
import { useFormStatus } from "react-dom";
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
  function IconButton({ className, disabled, ...props }, ref) {
    // See button.tsx's own comment: reports false, harmlessly, outside a
    // <form>; scopes correctly to just the enclosing form's own submit.
    const { pending } = useFormStatus();
    return (
      <button
        ref={ref}
        disabled={disabled || pending}
        className={cn(
          "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-line bg-transparent text-ink-soft transition-colors hover:border-rust hover:text-rust disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
