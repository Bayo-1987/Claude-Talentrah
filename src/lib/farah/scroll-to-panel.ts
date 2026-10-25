import { isPhoneWidth } from "@/lib/farah/launcher-rules";

/**
 * Bring Farah to the reader. The ONE function every entry uses: the masthead's two "Ask Farah" items, the first-visit hint's "Show me", the job's "Ask Farah" link and the launcher.
 *
 * ABOVE 760px the panel is the docked right-hand column. If it is not in view it is scrolled into view; if it is, nothing moves.
 * BELOW 760px the same mounted panel is the bottom sheet (src/components/app-shell/farah-sheet-host.tsx), so "bring her to the reader" means open the sheet. The sheet host listens for
 * FARAH_OPEN_SHEET_EVENT; if nothing answers (a page without the signed-in shell) this falls back to the old scroll, so the call never silently does nothing.
 *
 * THE FOLLOW-UP. `afterReveal` runs once Farah can be seen: at once above 760px (or with no host), and on a phone only AFTER the sheet is open and painted. The job's "Ask Farah" link hands its
 * seed in here, because the panel moves keyboard focus to the new job's first option when a seed arrives, and focus cannot land on an element that is still hidden. Seeding before the sheet
 * opened would have left focus on the card and the options out of reach.
 *
 * WHY DOM AND NOT REACT STATE. The masthead, the launcher and the panel are siblings under (app)/layout.tsx. Wiring them through state would mean lifting a ref or a context into a server
 * layout purely so a few buttons can point at a panel that is already on the page and already addressable. A querySelector against the panel's own test id, and one window event, is the
 * smaller thing, and it cannot desynchronise from what is rendered.
 *
 * THE VISIBILITY GUARD IS NOT AN OPTIMISATION. Above 760px the panel is a sticky column that is already on screen; `scrollIntoView` there scrolls to the element's position in FLOW, near the
 * top of the column, so pressing "Ask Farah" while reading job 30 would throw the reader back up the page to reach something they could already see.
 */

export const FARAH_PANEL_SELECTOR = '[data-testid="farah-panel"]';

/** True when the element's top edge is already within the viewport. */
function alreadyInView(el: Element): boolean {
  const { top, bottom } = el.getBoundingClientRect();
  const viewport = window.innerHeight || document.documentElement.clientHeight;
  // Top edge visible, or the element spans the whole viewport.
  return top >= 0 && top < viewport && bottom > 0;
}

/** Dispatched on window on a phone; the sheet host answers by setting `detail.handled`. */
export const FARAH_OPEN_SHEET_EVENT = "farah:open-sheet";

export interface OpenSheetDetail {
  /** The element that asked (the focused one at the time); focus returns to it when the sheet closes. May be the body, which the host treats as "none". */
  opener: Element | null;
  /** Run once the sheet is open and painted. */
  after?: () => void;
  /** Set to true by the host. */
  handled: boolean;
}

export function scrollToFarahPanel(rawAfterReveal?: () => void): void {
  // A bare `onClick={scrollToFarahPanel}` would hand the click event in here; anything that is not a function is no follow-up.
  const afterReveal = typeof rawAfterReveal === "function" ? rawAfterReveal : undefined;
  if (isPhoneWidth(window.innerWidth)) {
    const detail: OpenSheetDetail = { opener: document.activeElement, after: afterReveal, handled: false };
    window.dispatchEvent(new CustomEvent<OpenSheetDetail>(FARAH_OPEN_SHEET_EVENT, { detail }));
    if (detail.handled) return;
  }
  const panel = document.querySelector(FARAH_PANEL_SELECTOR);
  if (!panel || alreadyInView(panel)) {
    afterReveal?.();
    return;
  }

  // Honour the OS setting rather than animating over someone who asked us not
  // to — the same reason nothing else in this codebase animates by default.
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  panel.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  afterReveal?.();
}
