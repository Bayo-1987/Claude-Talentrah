"use client";

import { cn } from "@/lib/cn";

export interface FilterChipProps {
  label: string;
  onRemove?: () => void;
  className?: string;
}

/** Bordered, removable filter tag. The × is always inline SVG — never a Unicode glyph or emoji. */
export function FilterChip({ label, onRemove, className }: FilterChipProps) {
  return (
    <span
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 border border-line px-3 text-[12.5px] font-semibold text-ink-soft",
        className,
      )}
    >
      {label}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label} filter`}
          onClick={onRemove}
          className="flex h-4 w-4 items-center justify-center"
        >
          <svg width="9" height="9" viewBox="0 0 20 20" fill="none">
            <path
              d="M4 4 L16 16 M16 4 L4 16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </span>
  );
}
