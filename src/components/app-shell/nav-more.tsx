"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { MORE_BUTTON_CLASS, moreItemClassFor } from "@/components/app-shell/nav-model";
import type { NavLink } from "@/components/app-shell/nav-model";

/**
 * "More": the overflow control of the stepped bar (see nav-model.ts). It lists every link that has a later step, and each row hides itself at the width where that link joins the bar, so the same
 * markup serves all four steps and nothing is measured in JavaScript. The whole control hides at 1536, where the bar holds everything.
 *
 * Same contract as the account menu and the phone disclosure: outside click and Escape close it, focus goes into the panel on open and back to the button on a close that does not navigate.
 */
export function NavMore({ items }: { items: Array<{ link: NavLink; href: string; active: boolean }> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // The first row that is actually on screen at this width (a row that has already joined the bar is display:none and cannot take focus).
    Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
      .find((el) => el.offsetParent !== null)
      ?.focus();
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setTimeout(() => triggerRef.current?.focus(), 0);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const anyActive = items.some((i) => i.active);

  return (
    <div ref={ref} data-testid="masthead-nav-more" className={cn("relative flex items-center", MORE_BUTTON_CLASS)}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex min-h-10 min-w-10 items-center justify-center gap-1 border-b-[2.5px] font-body text-[14.5px] font-semibold no-underline",
          anyActive ? "border-rust text-rust" : "border-transparent text-ink hover:text-rust-hover",
        )}
      >
        More
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute top-[calc(100%+8px)] left-0 z-20 w-[220px] border-[1.5px] border-ink bg-card">
          {items.map(({ link, href, active }) => (
            <Link
              key={link.href}
              href={href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={cn(
                "min-h-11 items-center px-4 font-body text-[14px] font-semibold no-underline hover:bg-rust-soft",
                // The row exists for every link with a later step; the step at which the link reaches the bar hides it here. `flex` is the base so the hide class has something to beat.
                "flex",
                moreItemClassFor(link),
                active ? "text-rust" : "text-ink hover:text-rust",
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
