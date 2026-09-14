"use client";

import { useFormStatus } from "react-dom";

/**
 * "Mark as applied" (external jobs) — a raw `<button>`, not the shared
 * `Button` component: `Button`'s "text" variant is close but not identical
 * (different padding/min-height), and swapping it in would shift this
 * row's layout for a pending-state fix that doesn't need to. job-card.tsx
 * (the parent) is a Server Component, so this needs its own file to call
 * useFormStatus at all.
 */
export function MarkAppliedButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust disabled:cursor-not-allowed disabled:opacity-50"
    >
      Mark as applied
    </button>
  );
}
