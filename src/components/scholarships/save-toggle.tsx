"use client";

import { saveScholarshipAction, unsaveScholarshipAction } from "@/lib/scholarships/actions";
import { cn } from "@/lib/cn";

/**
 * Bookmark toggle. Circular 40×40 hit target like the Job Feed's save/share
 * icon buttons — the icon glyph is smaller than the target on purpose
 * (design system: every interactive element needs a real ≥40×40 area, which
 * was a genuine shipped bug once).
 */
export function SaveToggle({ scholarshipId, isSaved }: { scholarshipId: string; isSaved: boolean }) {
  const action = isSaved ? unsaveScholarshipAction : saveScholarshipAction;

  return (
    <form action={action.bind(null, scholarshipId)}>
      <button
        type="submit"
        aria-label={isSaved ? "Remove from saved scholarships" : "Save this scholarship"}
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line transition-colors",
          isSaved ? "border-rust text-rust" : "text-ink-soft hover:border-rust hover:text-rust",
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
    </form>
  );
}
