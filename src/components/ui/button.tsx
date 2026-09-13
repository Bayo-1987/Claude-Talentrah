"use client";

import { forwardRef } from "react";
import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes } from "react";
import { buttonClasses, type ButtonVariant, type ButtonSize } from "@/lib/button-classes";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /**
   * "md" = marketing-site scale (Main-Sunbird.dc.html), "sm" = app/dashboard
   * scale (JobFeed-Sunbird.dc.html). Only primary/secondary/ghost at "md" and
   * primary/text at "sm" are pixel-sourced from the reference files; other
   * combinations are a reasonable extrapolation — check against a real screen
   * before treating them as final.
   */
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "primary", size = "md", className, disabled, ...props },
    ref,
  ) {
    /*
     * useFormStatus reports the nearest enclosing <form>'s own pending
     * state — false, harmlessly, for a Button that isn't inside a <form>
     * (a dialog's Cancel, etc.). Every CTA that submits via
     * `<form action={serverAction}>` (Save, Apply, Mark as applied, Buy)
     * gets a real disabled+dimmed state on click with no per-call-site
     * change: each button's own <form> wraps only itself (job-card.tsx,
     * save-toggle.tsx, billing/page.tsx), so this scopes correctly even on
     * a page with many independent forms like the job feed — it is never a
     * page-wide pending flag.
     */
    const { pending } = useFormStatus();
    return (
      <button
        ref={ref}
        disabled={disabled || pending}
        className={buttonClasses(variant, size, className)}
        {...props}
      />
    );
  },
);
