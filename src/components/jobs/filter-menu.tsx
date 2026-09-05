"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

export interface FilterMenuItem {
  href: string;
  label: string;
  selected: boolean;
  /** Shown right-aligned in the row. Omitted where a count isn't meaningful. */
  count?: number;
}

/**
 * A bordered menu button that opens a list of links — the jobs feed's Country
 * control, and (below ~900px) the Work type / Seniority / Posted controls
 * too. Native `<details>`/`<summary>`, matching this file's own JS-off
 * philosophy: with no JavaScript at all, clicking the summary still opens and
 * closes the menu and every link inside still works as a plain navigation.
 * What this component ADDS on top, and only on top, is keyboard/pointer
 * polish `<details>` doesn't provide natively — Escape closing the menu and
 * returning focus to the button, arrow keys moving between items, and
 * closing on an outside click. None of that is required for the base
 * control to function; it degrades to "click to open, click a link to
 * navigate" with zero script.
 *
 * "The button announces its value" (the accessibility requirement this
 * exists to satisfy) needs no extra ARIA: `faceLabel` IS the button's visible
 * and accessible text, so a screen reader reads exactly what a sighted user
 * sees on the button's face.
 */
export function FilterMenu({
  faceLabel,
  ariaLabel,
  items,
  sentinel,
  variant = "primary",
  testId,
}: {
  /** What renders on the button's face — a live value (Country) or a static category name (the others). */
  faceLabel: string;
  /** Accessible name when `faceLabel` alone doesn't say what the control is (a static category name needs none). */
  ariaLabel?: string;
  items: FilterMenuItem[];
  /** The escape-from-default row, rendered below a heavier divider — "Every country", never a fifth peer. */
  sentinel?: FilterMenuItem;
  /**
   * Per tests/ui/e2e-locators.test.ts: e2e specs may not locate elements by
   * CSS class. Country renders as its own FilterMenu at two breakpoints at
   * once (desktop row + mobile row, one hidden by CSS, both in the DOM), so
   * callers pass a breakpoint-qualified id for Country and a bare one for
   * the others, which only ever render once.
   */
  testId?: string;
  /** `quiet` is the mobile-collapsed Work type/Seniority/Posted styling — line border, ink-soft, regular weight. */
  variant?: "primary" | "quiet";
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;

    function onKeyDown(e: KeyboardEvent) {
      if (!details) return;
      if (e.key === "Escape" && details.open) {
        e.preventDefault();
        details.open = false;
        details.querySelector("summary")?.focus();
        return;
      }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && details.open) {
        const links = [...details.querySelectorAll<HTMLAnchorElement>("a[href]")];
        if (links.length === 0) return;
        e.preventDefault();
        const idx = links.indexOf(document.activeElement as HTMLAnchorElement);
        const down = e.key === "ArrowDown";
        const next = idx === -1 ? (down ? 0 : links.length - 1) : (idx + (down ? 1 : -1) + links.length) % links.length;
        links[next]?.focus();
      }
    }

    // Outside click closes — a menu that only Escape can dismiss surprises a
    // mouse user, who never reaches for Escape.
    function onPointerDown(e: PointerEvent) {
      if (!details) return;
      if (details.open && !details.contains(e.target as Node)) details.open = false;
    }

    details.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      details.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  const summaryClass =
    variant === "quiet"
      ? "border-line font-normal text-ink-soft hover:border-rust hover:text-rust [details[open]_&]:border-rust [details[open]_&]:text-rust"
      : "border-ink font-semibold text-ink hover:border-rust hover:text-rust";

  return (
    <details ref={detailsRef} className="relative inline-block" data-testid={testId}>
      <summary
        aria-label={ariaLabel}
        className={`flex min-h-10 min-w-10 cursor-pointer list-none items-center gap-2 border-[1.5px] bg-card px-3 font-body text-[13.5px] whitespace-nowrap [&::-webkit-details-marker]:hidden ${summaryClass}`}
      >
        {faceLabel}
        <span
          aria-hidden="true"
          className="mt-[-3px] inline-block h-[7px] w-[7px] flex-none rotate-45 border-r-[1.6px] border-b-[1.6px] border-current [details[open]_&]:mt-[2px] [details[open]_&]:rotate-[225deg]"
        />
      </summary>
      <div className="absolute top-[calc(100%+6px)] left-0 z-20 min-w-[212px] border-[1.5px] border-ink bg-card">
        {items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className={`flex min-h-10 items-center justify-between gap-4 border-b border-line px-3.5 text-[13.5px] no-underline last:border-b-0 hover:bg-rust-soft ${
              item.selected ? "font-bold text-rust" : "text-ink"
            }`}
          >
            <span>{item.label}</span>
            {item.count !== undefined && (
              <span className="text-[12.5px] text-ink-soft">{item.count}</span>
            )}
          </Link>
        ))}
        {sentinel && (
          <Link
            href={sentinel.href}
            className="flex min-h-10 items-center justify-between gap-4 border-t-[1.5px] border-ink px-3.5 font-display text-[13.5px] text-ink italic no-underline hover:bg-rust-soft"
          >
            <span>{sentinel.label}</span>
            {sentinel.count !== undefined && (
              <span className="text-[12.5px] text-ink-soft">{sentinel.count}</span>
            )}
          </Link>
        )}
      </div>
    </details>
  );
}
