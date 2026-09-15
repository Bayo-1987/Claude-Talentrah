"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";

export interface FilterChipProps {
  label: string;
  /**
   * True for a free-text search term specifically — CLAUDE.md's "italic
   * Newsreader = quiet/secondary asides" doesn't fit an active filter word,
   * but a typed term is a quote of what the user wrote, not a facet label,
   * and the two should not look identical in a mixed summary line.
   */
  quoted?: boolean;
  onRemove?: () => void;
  /**
   * Same removal affordance as `onRemove`, as a plain navigable link instead
   * of a click handler — for a caller with no client-side filter state of
   * its own (the jobs feed's filter bar is server-rendered links only, "with
   * JS off this is the same GET-driven page it has always been"; a
   * click-handler-only removal would be the one control on that page that
   * needs JS). Exactly one of `onRemove`/`removeHref` should be passed.
   */
  removeHref?: string;
  className?: string;
}

/** The 9px × glyph, shared by both removal affordances below — inline SVG, never a Unicode glyph or emoji. */
function RemoveGlyph() {
  return (
    <svg width="9" height="9" viewBox="0 0 20 20" fill="none">
      <path d="M4 4 L16 16 M16 4 L4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/*
  The 9px x is what you see; the control is what you hit. h-4 w-4 made those
  the same thing at 16x16, which is the exact shape of the bug CLAUDE.md's
  >=40x40 rule was written after — "icon glyph sized != clickable area sized".

  `-mr-3` pulls the target out over the chip's own right padding, so a real
  40x40 target costs the chip 28px of width rather than 40. The chip's
  min-h-10 already supplies the height.
*/
const REMOVE_TARGET_CLASS = "-mr-3 flex min-h-10 min-w-10 items-center justify-center";

/** Bordered, removable filter tag. */
export function FilterChip({ label, quoted = false, onRemove, removeHref, className }: FilterChipProps) {
  return (
    <span
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 border border-line px-3 text-[12.5px] font-semibold text-ink-soft",
        className,
      )}
    >
      <span className={quoted ? "font-display italic" : undefined}>{label}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label} filter`}
          onClick={onRemove}
          className={REMOVE_TARGET_CLASS}
        >
          <RemoveGlyph />
        </button>
      )}
      {removeHref && !onRemove && (
        <Link href={removeHref} aria-label={`Remove ${label} filter`} className={REMOVE_TARGET_CLASS}>
          <RemoveGlyph />
        </Link>
      )}
    </span>
  );
}
