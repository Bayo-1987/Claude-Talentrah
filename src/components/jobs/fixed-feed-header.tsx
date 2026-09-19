"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * The feed's steering row — tabs, Auto-Apply, filters — pinned to the viewport.
 *
 * ── Why this is a component and not two Tailwind classes ──────────────────
 *
 * It was `sticky top-[68px]`, which worked. `fixed` is a different thing and
 * needs three problems solved that `sticky` solved for free:
 *
 *  1. WIDTH. A sticky element keeps the width it had in normal flow. A fixed
 *     one does not — it is sized against the viewport, so `left-0 right-0`
 *     would stretch it across the whole window, past the 1360px shell, under
 *     the 280px Farah panel and outside the column's 40px padding. The column
 *     it belongs to is `min(viewport, 1360) - 280 - 80` wide and centred,
 *     which is not expressible as static left/right values. So the geometry is
 *     measured from the placeholder that stays in flow and applied inline.
 *
 *  2. FLOW. A fixed element is out of flow entirely, so everything below it
 *     moves up by its height unless something holds the space. That is the
 *     spacer.
 *
 *  3. HEIGHT. The spacer cannot be a hardcoded number, because the row's
 *     height is a function of viewport width.
 *
 *     That was overwhelmingly true when this held the Auto-Apply card and the
 *     whole filter bar too: 488px at 1280 and 1586px at 390, where the filter
 *     control alone went from one line to three. Those have since moved out —
 *     what is pinned now is the eyebrow and the four tabs — so the range is
 *     far narrower. It is not zero: four tabs still wrap on a small screen,
 *     and a hardcoded height would be wrong on one side of that. The
 *     ResizeObserver stays; it just has less to absorb.
 *
 * ── The order of the first paint, which is what stops the jump ────────────
 *
 * The bar renders IN FLOW on the server and on the first client render, then
 * switches to fixed in a layout effect once measured. Both states put it in
 * the same place, so nothing moves; the difference is only which mechanism
 * holds it there. Rendering it fixed from the start would mean one frame at
 * the wrong width — full-viewport, before the measurement lands — which is
 * exactly the flash this ordering avoids.
 *
 * ── The containing-block trap ─────────────────────────────────────────────
 *
 * `position: fixed` anchors to the viewport ONLY while no ancestor has
 * `transform`, `filter`, `perspective`, `backdrop-filter`, `contain: paint`
 * or a `will-change` naming any of them. Any one of those makes that ancestor
 * the containing block and the element silently scrolls with the page while
 * still saying `position: fixed` in devtools. Checked at the time of writing:
 * globals.css sets none of them, and no ancestor class between this row and
 * <html> introduces one. It is not something a comment can keep true, so
 * e2e/fixed-tab-row.spec.ts asserts the actual behaviour — that the row's
 * viewport coordinates do not move under scroll — rather than the CSS.
 */

/**
 * useLayoutEffect on the client, useEffect on the server render.
 *
 * Plain useLayoutEffect warns when a component is server-rendered, and plain
 * useEffect would let one frame paint before the switch to fixed — visible
 * only when the browser restores a scroll position on load, which is rare and
 * ugly. This keeps the pre-paint timing without the warning.
 */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface Metrics {
  /** Viewport-relative left edge of the in-flow column. */
  left: number;
  width: number;
  height: number;
  /** Viewport-relative distance from the top: the masthead's real bottom edge. */
  top: number;
}

/**
 * Fallback distance from the top of the viewport, used only if the masthead
 * band cannot be found in the DOM. In the normal case `top` is measured live
 * (see `measure` below) rather than assumed, because the masthead is no
 * longer guaranteed to be the first thing in the viewport: send-406's cookie
 * consent banner renders in the root layout ABOVE the app shell, so on a
 * first visit (before the banner is dismissed) the masthead's own sticky
 * resting position is pushed down by the banner's height. A hardcoded 68
 * here reproduced exactly that regression — this row pinned itself under a
 * masthead that, at rest, was no longer where 68 assumed it was.
 */
export const FEED_HEADER_TOP = 68;

function sameBox(a: Metrics | null, b: Metrics): boolean {
  if (!a) return false;
  // Sub-pixel tolerance. Layout produces fractional values that jitter by
  // hundredths on scroll; without this the observer and the state update each
  // other forever.
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5
  );
}

function measureTop(): number {
  const masthead = document.querySelector('[data-testid="masthead-band"]');
  return masthead ? masthead.getBoundingClientRect().bottom : FEED_HEADER_TOP;
}

export function FixedFeedHeader({ children }: { children: ReactNode }) {
  const spacerRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useIsomorphicLayoutEffect(() => {
    const spacer = spacerRef.current;
    const bar = barRef.current;
    if (!spacer || !bar) return;

    let frame = 0;

    const measure = () => {
      const s = spacer.getBoundingClientRect();
      const next: Metrics = {
        left: s.left,
        width: s.width,
        height: bar.getBoundingClientRect().height,
        top: measureTop(),
      };
      setMetrics((prev) => (sameBox(prev, next) ? prev : next));
    };

    /*
     * Coalesced into a frame. Observing both boxes means one width change can
     * fire the observer three times — spacer resizes, bar re-wraps, spacer
     * height follows — and measuring synchronously inside a ResizeObserver
     * callback that then writes layout is how you get the browser's
     * "ResizeObserver loop completed with undelivered notifications" warning.
     */
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    measure();

    const observer = new ResizeObserver(schedule);
    // The spacer gives horizontal geometry (it is still in flow); the bar
    // gives height, which changes when the filters wrap.
    observer.observe(spacer);
    observer.observe(bar);
    window.addEventListener("resize", schedule);

    /*
     * The masthead band doesn't resize when the cookie consent banner mounts
     * or unmounts above it — its own height is unchanged, only its position
     * shifts, which ResizeObserver cannot see. A mutation on <body>'s direct
     * children (the banner's own mount point, right beside the app shell) is
     * what actually fires when that happens, so that's what re-triggers the
     * `top` measurement above rather than leaving it stale until some
     * unrelated resize happens to run it again.
     */
    const bodyObserver = new MutationObserver(schedule);
    bodyObserver.observe(document.body, { childList: true });

    /*
     * While the banner is visible it is real, in-flow content ABOVE the
     * masthead, so the masthead's own sticky "at rest" position (before any
     * scroll) sits below it — not at 0. Scrolling past the banner's height
     * is what lets the masthead's `sticky top-0` reach its stuck position at
     * the very top. Those are two different real values now, not a constant,
     * so `top` has to keep tracking the masthead's live bottom edge through
     * the scroll itself, the same way a plain `position: sticky` element
     * would for free — this is the one piece of tracking `fixed` doesn't get
     * for free and still needs, on top of the width/height problems in this
     * file's own header comment.
     */
    window.addEventListener("scroll", schedule, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      bodyObserver.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
    };
  }, []);

  const fixed = metrics !== null;

  return (
    /*
     * `-mt-8` is inherited from the sticky version and still load-bearing:
     * (app)/layout.tsx wraps this page in `py-8`, so without pulling back that
     * 32px the row would start 32px below the masthead and leave a strip of
     * paper above it. Pulling up by exactly the layout's padding and re-adding
     * it as `pt-8` inside the bar is what makes the row sit flush at 68.
     */
    <div
      ref={spacerRef}
      data-testid="feed-header-spacer"
      className="-mt-8"
      style={fixed ? { height: metrics.height } : undefined}
    >
      <div
        ref={barRef}
        data-testid="feed-header"
        className="z-10 flex flex-col gap-5 bg-paper pt-8 pb-4"
        style={
          fixed
            ? {
                position: "fixed",
                top: metrics.top,
                left: metrics.left,
                width: metrics.width,
              }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
