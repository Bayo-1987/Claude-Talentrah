"use client";

import { useState, useTransition } from "react";
import { FarahMark } from "@/components/ui/farah-mark";
import { dismissFarahHintAction } from "@/lib/profile/settings-actions";
import { scrollToFarahPanel } from "@/lib/farah/scroll-to-panel";

/**
 * A one-time nudge toward Farah, pointing at whichever affordance is actually
 * on screen.
 *
 * ── IT POINTS AT THREE DIFFERENT THINGS, BECAUSE THERE ARE THREE ──────────
 *
 * The shell already reaches Farah three ways, and which one exists depends
 * entirely on the viewport. A hint that said "use the bar at the bottom" would
 * be wrong on a desktop, and one that said "look at the right-hand column"
 * would point at nothing on a phone. So the copy and the position both move
 * with the same breakpoints the affordances themselves use — no new numbers
 * are introduced here:
 *
 *   below 760   FarahMobileTab, fixed to the bottom      -> hint sits above it
 *   760 to 2xl  the panel itself, a sticky right column  -> hint sits beside it
 *   2xl and up  the masthead's "Ask Farah" item          -> hint sits under it
 *
 * The three variants are three spans with responsive visibility rather than a
 * JS media query, which keeps the server and client markup identical and means
 * there is no flash of the wrong sentence during hydration.
 *
 * ── WHY IT IS NOT AN OVERLAY, A MODAL OR A SPOTLIGHT ──────────────────────
 *
 * CLAUDE.md rules out gamification chrome, and the panel is deliberately built
 * as marginalia rather than as a widget that demands attention. A dimmed
 * backdrop with a cut-out would contradict both, and would be the most
 * attention-grabbing element in an app whose argument is that it is calm. This
 * is a small bordered box in the design system's own language — 1.5px ink, no
 * radius, no shadow — that can be ignored without being dismissed.
 *
 * ── LAYERING, AND WHY IT DOES NOT SWALLOW CLICKS ──────────────────────────
 *
 * z-[19]: above FarahMobileTab (18) so it is never behind the bar it is
 * pointing at, and below the masthead band (20) so a masthead dropdown still
 * wins.
 *
 * `pointer-events-none` on the box, `pointer-events-auto` on its two buttons,
 * and that is a bug fix rather than a flourish. This thing appears UNBIDDEN,
 * on every authenticated page, over a feed whose surface is almost entirely
 * interactive — job cards, filter chips, the Auto-Apply toggle. As a plain
 * fixed box it therefore blocked whatever it happened to land on: CI caught it
 * on `auto-apply.spec.ts`, where Playwright reported the hint "intercepts
 * pointer events" and the toggle could not be clicked for 30 seconds.
 *
 * There is no safe place to put it instead. The centre column is cards, the
 * right column is the panel it points at, and moving it down only changes
 * which control it covers. So the box does not take clicks at all — everything
 * behind it stays usable, and only the two buttons are targets.
 *
 * The rule this encodes: an uninvited overlay may occupy space, but it may not
 * take the app away from someone who is trying to use it.
 */
export function FarahFirstVisitHint() {
  // Optimistic, and the state is local rather than derived from the action.
  // "Do not show this again" should take effect on the click, not on the round
  // trip — a hint that lingers while a write completes is a hint that did not
  // respond to being dismissed.
  const [gone, setGone] = useState(false);
  const [, startTransition] = useTransition();

  function dismiss() {
    setGone(true);
    startTransition(() => {
      void dismissFarahHintAction();
    });
  }

  if (gone) return null;

  return (
    <div
      data-testid="farah-first-visit-hint"
      /*
       * role="status" rather than a dialog. It is not modal, it traps nothing,
       * and it does not need to be acknowledged before the app is usable — a
       * dialog role would promise all three. `polite` lets a screen reader
       * finish the page before announcing it.
       */
      role="status"
      aria-live="polite"
      className={[
        "pointer-events-none fixed z-[19] w-[min(320px,calc(100vw-32px))] border-[1.5px] border-ink bg-card px-4 pt-3.5 pb-4 print:hidden",
        // below 760: just above the fixed bar (58.5px + a gap), centred.
        "bottom-[76px] left-1/2 -translate-x-1/2",
        /*
         * 760 and up: released from the bottom and tucked under the masthead,
         * BESIDE the panel rather than over it.
         *
         * TWO WRONG ANSWERS BEFORE THIS ONE, both caught by measuring.
         *
         * `right-6` put the hint ON the panel, covering Farah's greeting —
         * pointing at something while obscuring it. A flat `right-[312px]`
         * (280px panel + 32px gap) fixed that at 1280 and still overlapped by
         * 56px at 1536, because the shell is `max-w-[1360px]` and CENTRED: past
         * 1360 the panel stops being flush with the viewport edge and a
         * viewport-relative offset drifts into it by exactly the margin.
         *
         * So the offset has to track the container, not the window:
         *
         *   50vw - min(680px, 50vw)   the left margin of a centred 1360px box,
         *                             and 0 while the viewport is narrower
         *   + 312px                   the panel plus its gap
         *
         * Measured right edge vs the panel's left edge: 968 vs 1000 at 1280,
         * 1136 vs 1168 at 1536, 1232 vs 1264 at 1728. A 32px gap at every
         * width, which is the point.
         */
        "min-[760px]:top-[84px] min-[760px]:right-[calc(50vw_-_min(680px,50vw)_+_312px)] min-[760px]:bottom-auto min-[760px]:left-auto min-[760px]:translate-x-0",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex-shrink-0">
          <FarahMark size={28} />
        </span>
        <div className="min-w-0">
          <p className="font-display text-[15px] font-semibold text-ink">
            Farah is here to help.
          </p>

          {/*
            One sentence per breakpoint, naming the thing that is actually on
            screen. Rendered as three spans so the markup is identical on the
            server and the client; only one is ever visible.
          */}
          <p className="mt-1 text-[13px] leading-[1.5] text-ink-soft">
            <span className="min-[760px]:hidden">
              She can tailor your resume or prep you for an interview. Tap{" "}
              <span className="font-semibold text-ink">Ask Farah</span> at the bottom of the
              screen whenever you need her.
            </span>
            <span className="hidden min-[760px]:inline 2xl:hidden">
              She can tailor your resume or prep you for an interview. She&apos;s in the
              column on the right, and stays there as you scroll.
            </span>
            <span className="hidden 2xl:inline">
              She can tailor your resume or prep you for an interview. Use{" "}
              <span className="font-semibold text-ink">Ask Farah</span> in the menu bar, or the
              column on the right.
            </span>
          </p>

          <div className="mt-3 flex items-center gap-3">
            {/*
              "Show me" scrolls the panel into view — the same helper the
              masthead item and the bar use, including its already-in-view
              guard, so on a desktop where the panel is visible this does
              nothing rather than throwing the reader up the page.

              It dismisses as well: someone who followed the hint has, by any
              reasonable reading, seen it.
            */}
            <button
              type="button"
              onClick={() => {
                scrollToFarahPanel();
                dismiss();
              }}
              className="pointer-events-auto inline-flex min-h-10 items-center justify-center border-none bg-ink px-4 font-body text-[13px] font-semibold text-paper transition-colors hover:bg-rust"
            >
              Show me
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="pointer-events-auto inline-flex min-h-10 min-w-10 items-center justify-center px-1 font-body text-[13px] font-semibold text-ink-soft hover:text-rust"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
