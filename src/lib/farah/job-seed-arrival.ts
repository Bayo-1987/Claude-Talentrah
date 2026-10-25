import type { FarahJobSeed } from "@/lib/farah/job-seed";

/**
 * What the Farah panel does the moment a job arrives from an "Ask Farah" click (FARAH-JOB-CTX-1).
 *
 * THE BUG THIS ANSWERS. The click handed the job to the panel and the options appeared, but the reader saw nothing happen: the new block is added at the END of the panel's 320px scroller, below the
 * fold of it, nothing scrolled it into view (the scroller only follows new MESSAGES), keyboard focus stayed on the card's button, and nothing was announced. Measured on the old code with a long thread:
 * the block sat at 332px in a 320px scroller, scrollTop unchanged, focus still on "Ask Farah", live region empty.
 *
 * So arrival now does three things, none of which sends anything: it scrolls the new block into view (inside the panel), it moves keyboard focus to the first option the reader can use, and (in the panel) it says so in the
 * polite live region. This file holds the pieces that need no React, so they can be tested against fake elements: this project's unit environment has no DOM.
 */

/** Marks each option (a question or a link) in the block, so focus can find the first usable one. */
export const JOB_OPTION_ATTR = "data-job-option";
export const JOB_OPTION_SELECTOR = `[${JOB_OPTION_ATTR}]:not([disabled]):not([aria-disabled="true"])`;

/** The polite announcement: which job Farah has, and that nothing has been sent (the reader's free messages are untouched until they choose an option). */
export function jobSeedAnnouncement(seed: FarahJobSeed): string {
  return `Farah has ${seed.jobTitle} at ${seed.companyName}. Choose a question or a link in the panel. Nothing has been sent.`;
}

/** The OS setting for less motion. False where it cannot be read (the server, an old browser): motion is then allowed, as everywhere else in this codebase. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** The scrolling box the block sits in (the panel's 320px conversation scroller). */
export interface RevealScroller {
  scrollTop: number;
  clientHeight: number;
  getBoundingClientRect(): { top: number; bottom: number };
  scrollTo(options: ScrollToOptions): void;
}

/** The parts of an element the reveal uses (an HTMLElement satisfies this; the tests pass a fake). */
export interface RevealableBlock {
  offsetHeight: number;
  parentElement: RevealScroller | null;
  getBoundingClientRect(): { top: number; bottom: number };
  scrollIntoView(options: ScrollIntoViewOptions): void;
  focus(options?: FocusOptions): void;
  querySelector(selector: string): { focus(options?: FocusOptions): void } | null;
}

/**
 * Where the scroller should scroll to so the block is seen, or null when it already is.
 *  - A block that fits in the scroller: the least movement that shows all of it.
 *  - A block TALLER than the scroller (the divider, chip, label, opener and four options are about 480px; the scroller is 320px): its top, so the chip and the first options are what the reader sees and the
 *    rest is one scroll away. Showing its bottom instead would show the links and hide the job.
 */
export function jobBlockScrollTarget(block: { height: number; top: number; bottom: number }, scroller: { scrollTop: number; clientHeight: number; top: number; bottom: number }): number | null {
  const above = block.top - scroller.top; // negative: the block starts above the scroller's visible part
  const below = block.bottom - scroller.bottom; // positive: the block runs past the bottom
  if (block.height > scroller.clientHeight) return above === 0 ? null : Math.max(0, scroller.scrollTop + above);
  if (above < 0) return Math.max(0, scroller.scrollTop + above);
  if (below > 0) return scroller.scrollTop + below;
  return null;
}

/**
 * Brings the newly added job block into view and puts keyboard focus on it.
 *
 *  - SCROLL: the panel's own scroller only (never the page: the page is the reader's place in the feed; on a phone the click handler has already brought the stacked panel into view, see
 *    scroll-to-panel.ts). Smooth unless the reader asked for reduced motion. With no scroller to find, the block is scrolled into view by the least movement instead.
 *  - FOCUS: the first option that is not disabled; if every option is disabled (a reply is streaming) the block itself, which takes focus (tabindex -1), so the keyboard still lands on the new job.
 *    `preventScroll` so the focus call can never change where the scroll above ended.
 *
 * Returns what took the focus, for the tests. Sends nothing and calls nothing else.
 */
export function revealJobBlock(block: RevealableBlock | null, reducedMotion: boolean): "option" | "block" | "none" {
  if (!block) return "none";
  const behavior = reducedMotion ? "auto" : "smooth";
  const scroller = block.parentElement;
  if (scroller) {
    const b = block.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    const top = jobBlockScrollTarget({ height: block.offsetHeight, top: b.top, bottom: b.bottom }, { scrollTop: scroller.scrollTop, clientHeight: scroller.clientHeight, top: s.top, bottom: s.bottom });
    if (top !== null) scroller.scrollTo({ top, behavior });
  } else {
    block.scrollIntoView({ block: "nearest", inline: "nearest", behavior });
  }
  const option = block.querySelector(JOB_OPTION_SELECTOR);
  if (option) {
    option.focus({ preventScroll: true });
    return "option";
  }
  block.focus({ preventScroll: true });
  return "block";
}
