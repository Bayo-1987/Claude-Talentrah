"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  GROUP_LABEL,
  GROUP_ORDER,
  defaultSuggestions,
  filterSuggestions,
  type Suggestion,
} from "@/lib/jobs/search-suggestions";

/**
 * The feed's search field, with a suggestion list.
 *
 * ── PROGRESSIVE ENHANCEMENT, NOT A REPLACEMENT ────────────────────────────
 *
 * This renders the SAME `<input name="q">` inside the SAME GET form that was
 * here before. With JavaScript off, or before hydration, it is exactly the
 * old control: type, press Enter, the form navigates, the query lives in the
 * URL and the board stays shareable and back-buttonable. The listbox is added
 * on top and selecting from it just fills the input and submits the form — no
 * new URL parameter, no new server behaviour, nothing that only works with JS.
 *
 * ── NOTHING ABOUT THE VISITOR IS STORED ───────────────────────────────────
 *
 * No recent searches, no localStorage, no per-visitor state of any kind. Job
 * hunting is confidential and this market skews toward shared and borrowed
 * devices; a remembered search list would tell the next person on the device
 * what the last one was looking for. The untyped list is a live summary of the
 * board instead — see defaultSuggestions.
 *
 * ── ARIA 1.2 COMBOBOX ─────────────────────────────────────────────────────
 *
 * The input keeps focus at all times and the active option is pointed at with
 * `aria-activedescendant`, rather than focus moving into the list. That is the
 * pattern screen readers expect here, and it is also why the arrow keys can
 * stay bound to the list while typing continues to work normally.
 *
 * Hover deliberately does NOT move the active option. If it did, a mouse
 * resting anywhere near the list would silently retarget what Enter does.
 */
export function SearchCombobox({
  defaultValue,
  index,
}: {
  defaultValue: string;
  /** Prebuilt on the server from the board currently in hand. */
  index: Suggestion[];
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const suggestions = useMemo(
    () => (value.trim() ? filterSuggestions(index, value) : defaultSuggestions(index)),
    [index, value],
  );

  /*
   * The free-text row is always last and always present, so the list never
   * traps you into picking a suggestion — the thing you typed is always still
   * offered, even when it matches nothing.
   */
  const freeTextIndex = value.trim() ? suggestions.length : -1;
  const optionCount = suggestions.length + (freeTextIndex >= 0 ? 1 : 0);

  /*
   * ── WHY THE LIST IS position:fixed AND MEASURED BY HAND ──────────────────
   *
   * The obvious implementation is an absolutely-positioned child of a
   * `relative` wrapper, and that is what this was. It rendered a real 851x277
   * box, in the DOM, with correct contents — and NOTHING WAS VISIBLE, because
   * the filter bar's instrument is `overflow-hidden` (it has to be: that is
   * what keeps the segment borders clean) and an absolutely-positioned
   * descendant is clipped by it.
   *
   * The reason this is written down at length is how it was found. Nine
   * Playwright tests passed against the invisible list, `toBeVisible()`
   * included — Playwright checks for a non-empty box and for
   * display/visibility, and an element clipped by an ancestor's overflow has
   * neither problem. A screenshot found it. That is the whole "a clean check
   * result is not proof" rule playing out in a new place, so the spec now also
   * asserts what `elementFromPoint` actually paints, which is the only check
   * that can tell these two states apart.
   *
   * position:fixed escapes ancestor overflow (only transform/filter/contain
   * ancestors would capture it, and there are none here), at the cost of
   * having to place it ourselves and follow the input on scroll and resize.
   */
  const [anchorRect, setAnchorRect] = useState<{ left: number; top: number; width: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (r) setAnchorRect({ left: r.left, top: r.bottom, width: r.width });
    };
    measure();
    // Capture phase, so a scroll inside any container moves the list too
    // rather than leaving it stranded over the page.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, suggestions.length]);

  // Close on a click outside. Pointerdown rather than click, so the list is
  // gone before a click on something behind it resolves.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function submitWith(next: string) {
    setValue(next);
    setOpen(false);
    setActive(-1);
    // requestSubmit, not submit(): it runs validation and fires the submit
    // event, which form.submit() skips. Deferred a tick so React has committed
    // the new value to the DOM input before the form serialises it.
    const form = inputRef.current?.form;
    requestAnimationFrame(() => form?.requestSubmit());
  }

  function choose(i: number) {
    if (i === freeTextIndex) return submitWith(value);
    const picked = suggestions[i];
    if (picked) submitWith(picked.value);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(e.key === "ArrowDown" ? 0 : optionCount - 1);
        return;
      }
      if (optionCount === 0) return;
      const down = e.key === "ArrowDown";
      setActive((prev) => {
        // Nothing active yet: enter at the end the key points to.
        if (prev === -1) return down ? 0 : optionCount - 1;
        // Otherwise step and wrap.
        return (prev + (down ? 1 : -1) + optionCount) % optionCount;
      });
      return;
    }

    if (e.key === "Home" || e.key === "End") {
      if (!open || optionCount === 0) return;
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : optionCount - 1);
      return;
    }

    if (e.key === "Enter") {
      // Only intercept when the user is actually pointing at an option;
      // otherwise this is a plain form submit and behaves exactly as before.
      if (open && active >= 0) {
        e.preventDefault();
        choose(active);
      }
      return;
    }

    if (e.key === "Escape") {
      // First press closes and keeps the text; a second clears the field.
      // Matches the platform convention, and means a mis-opened list never
      // costs you what you typed.
      if (open) {
        setOpen(false);
        setActive(-1);
      } else if (value) {
        setValue("");
      }
      return;
    }

    if (e.key === "Tab") {
      // Closes and moves on WITHOUT selecting. Selecting on Tab is a common
      // implementation and it surprises people: Tab means leave, not commit.
      setOpen(false);
      setActive(-1);
    }
  }

  const activeId = open && active >= 0 ? optionId(active) : undefined;

  return (
    <div ref={rootRef} className="flex min-w-0 flex-1 items-stretch">
      <label htmlFor="job-search" className="sr-only">
        Search jobs
      </label>
      <input
        ref={inputRef}
        id="job-search"
        name="q"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-haspopup="listbox"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search by title, company or location…"
        className="min-h-[42px] w-full min-w-0 flex-1 border-none bg-card px-3.5 font-display text-[13px] italic text-ink outline-none placeholder:text-ink-soft"
      />

      {/*
        Announced separately from the list, because a screen reader following
        aria-activedescendant is told about the ACTIVE option and never about
        how many there are.
      */}
      <span aria-live="polite" className="sr-only">
        {open ? `${optionCount} suggestion${optionCount === 1 ? "" : "s"}` : ""}
      </span>

      {open && optionCount > 0 && anchorRect && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search suggestions"
          /*
            Editorial: square corners, the same 1.5px ink border as the
            instrument it hangs off, --card ground, no shadow. Only the hero
            input carries a shadow in this design system.
          */
          style={
            anchorRect
              ? {
                  position: "fixed",
                  left: anchorRect.left,
                  top: anchorRect.top,
                  width: Math.max(anchorRect.width, 280),
                }
              : undefined
          }
          className="z-50 max-h-[60vh] overflow-y-auto border-[1.5px] border-ink bg-card"
        >
          {GROUP_ORDER.map((kind) => {
            const rows = suggestions
              .map((s, i) => ({ s, i }))
              .filter(({ s }) => s.kind === kind);
            if (rows.length === 0) return null;
            return (
              <li key={kind} role="presentation">
                <div
                  role="presentation"
                  className="border-b border-line px-3.5 pt-3 pb-1.5 font-body text-[11px] font-bold tracking-[0.14em] text-rust uppercase"
                >
                  {GROUP_LABEL[kind]}
                </div>
                <ul role="group" aria-label={GROUP_LABEL[kind]}>
                  {rows.map(({ s, i }) => (
                    <li
                      key={`${s.kind}-${s.value}`}
                      id={optionId(i)}
                      role="option"
                      aria-selected={active === i}
                      /*
                        onPointerDown, not onClick: the input would blur first
                        on a click and the list would already be gone.
                      */
                      onPointerDown={(e) => {
                        e.preventDefault();
                        choose(i);
                      }}
                      className={`flex min-h-10 cursor-pointer items-center justify-between gap-3 border-b border-line px-3.5 py-2 text-[13.5px] ${
                        active === i ? "bg-rust-soft text-ink" : "text-ink"
                      }`}
                    >
                      <span className="truncate">{s.value}</span>
                      <span className="shrink-0 text-[12px] text-ink-soft">
                        {s.count} {s.count === 1 ? "job" : "jobs"}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}

          {freeTextIndex >= 0 && (
            <li
              id={optionId(freeTextIndex)}
              role="option"
              aria-selected={active === freeTextIndex}
              onPointerDown={(e) => {
                e.preventDefault();
                choose(freeTextIndex);
              }}
              className={`flex min-h-10 cursor-pointer items-center px-3.5 py-2 text-[13.5px] ${
                active === freeTextIndex ? "bg-rust-soft text-ink" : "text-ink-soft"
              }`}
            >
              Search for <span className="ml-1 font-semibold text-ink">“{value.trim()}”</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
