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
 *
 * send-381 — the resting border was `border-line`, which measures 1.84:1
 * against both `--paper` and `--card`, well under WCAG 1.4.11's 3:1 minimum
 * for a control with no fill of its own (the border IS the entire visible
 * shape). `--line` is fine as a decorative divider elsewhere; it just isn't
 * strong enough to BE an interactive boundary. `border-ink-soft` matches the
 * icon's own resting color (already proven to clear the higher 4.5:1 text
 * bar against these same backgrounds, so it clears the lower 3:1 bar too)
 * and keeps the same relationship the hover state already has — border and
 * icon change color together, just ink-soft -> rust instead of line -> rust.
 * Hover is untouched.
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
          "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-ink-soft bg-transparent text-ink-soft transition-colors hover:border-rust hover:text-rust disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
