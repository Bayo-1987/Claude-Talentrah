/**
 * Bring the Farah panel into view.
 *
 * WHY DOM AND NOT REACT STATE. The masthead, the mobile tab and the panel are
 * siblings under (app)/layout.tsx. Wiring them through state would mean
 * lifting a ref or a context into a server layout purely so two buttons can
 * point at a third element that is already on the page and already addressable.
 * A querySelector against the panel's own test id is the smaller thing, and it
 * cannot desynchronise from what is rendered.
 *
 * THE VISIBILITY GUARD IS NOT AN OPTIMISATION. Above 760px the panel is a
 * sticky right-hand column that is already on screen; `scrollIntoView` there
 * scrolls to the element's position in FLOW, near the top of the column, so
 * pressing "Ask Farah" while reading job 30 would throw the reader back up the
 * page to reach something they could already see. Below 760 the panel is
 * stacked under the feed and genuinely off screen, which is the case the
 * scroll exists for. One function serves both because it asks first.
 */

export const FARAH_PANEL_SELECTOR = '[data-testid="farah-panel"]';

/** True when the element's top edge is already within the viewport. */
function alreadyInView(el: Element): boolean {
  const { top, bottom } = el.getBoundingClientRect();
  const viewport = window.innerHeight || document.documentElement.clientHeight;
  // Top edge visible, or the element spans the whole viewport.
  return top >= 0 && top < viewport && bottom > 0;
}

export function scrollToFarahPanel(): void {
  const panel = document.querySelector(FARAH_PANEL_SELECTOR);
  if (!panel || alreadyInView(panel)) return;

  // Honour the OS setting rather than animating over someone who asked us not
  // to — the same reason nothing else in this codebase animates by default.
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  panel.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}
