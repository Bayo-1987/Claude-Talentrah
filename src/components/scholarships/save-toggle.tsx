"use client";

import { useFormStatus } from "react-dom";
import { saveScholarshipAction, unsaveScholarshipAction } from "@/lib/scholarships/actions";
import { cn } from "@/lib/cn";

/**
 * Bookmark toggle. Circular 40×40 hit target like the Job Feed's save/share
 * icon buttons — the icon glyph is smaller than the target on purpose
 * (design system: every interactive element needs a real ≥40×40 area, which
 * was a genuine shipped bug once).
 *
 * A raw `<button>`, not the shared `IconButton` — it needs the isSaved
 * conditional border/text color, and blending that with IconButton's own
 * hardcoded classes would depend on Tailwind's generated stylesheet order,
 * not the order classes are listed here. So its pending state is wired
 * directly with useFormStatus rather than "coming free" from the shared
 * component the way job-card.tsx's Save/Apply buttons do.
 */
function ToggleButton({ isSaved }: { isSaved: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={isSaved ? "Remove from saved scholarships" : "Save this scholarship"}
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        isSaved ? "border-coral text-coral" : "text-ink-soft hover:border-coral hover:text-coral",
      )}
    >
      <svg width="16" height="16" viewBox="0 0 20 20" fill={isSaved ? "currentColor" : "none"}>
        <path
          d="M5 3h10v14l-5-4-5 4V3z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

export function SaveToggle({ scholarshipId, isSaved }: { scholarshipId: string; isSaved: boolean }) {
  const action = isSaved ? unsaveScholarshipAction : saveScholarshipAction;

  return (
    <form action={action.bind(null, scholarshipId)}>
      <ToggleButton isSaved={isSaved} />
    </form>
  );
}
