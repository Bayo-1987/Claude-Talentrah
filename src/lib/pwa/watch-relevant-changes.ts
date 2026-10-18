import { FARAH_FIRST_VISIT_HINT_TEST_ID } from "@/lib/farah/first-visit-hint-id";

/**
 * Re-decide the install strip's offer only when something that can change the answer appears or goes: Farah's first-visit hint or the cookie banner (and the
 * returning-visitor marker on <html>, an attribute).
 *
 * It used to observe EVERY change under <body> and decide each time; on a busy feed that is a decision per DOM change. A MutationObserver already batches records into one
 * callback; this filters them. A requestAnimationFrame debounce would also have thinned the calls, but frame callbacks do not run in a background tab, so the strip would not
 * re-decide until the tab was visible again; nothing here depends on frames.
 *
 * An added or removed node counts when it IS, or CONTAINS at any depth, the hint or the banner (a wrapper added or removed with the hint inside it must count, so the
 * subtree is searched, including a removed one: a detached node can still be searched). Pure functions over plain DOM-shaped objects, so they are tested with no browser
 * (tests/pwa/watch-relevant-changes.test.ts).
 */
export const COOKIE_BANNER_TEST_ID = "cookie-consent-banner";

const RELEVANT = `[data-testid="${FARAH_FIRST_VISIT_HINT_TEST_ID}"], [data-testid="${COOKIE_BANNER_TEST_ID}"]`;

function isOrContainsRelevant(node: Node): boolean {
  if (node.nodeType !== 1) return false; // text and comment nodes cannot be either
  const el = node as Element;
  return el.matches(RELEVANT) || el.querySelector(RELEVANT) != null;
}

export function isRelevantRecord(record: MutationRecord): boolean {
  // The only attribute observed is the returning-visitor marker, which is always relevant.
  if (record.type === "attributes") return true;
  for (const n of Array.from(record.addedNodes)) if (isOrContainsRelevant(n)) return true;
  for (const n of Array.from(record.removedNodes)) if (isOrContainsRelevant(n)) return true;
  return false;
}

/** Starts watching; returns the function that stops it. After it is called no further `decide` runs, even for records already queued. */
export function watchRelevantChanges(Observer: typeof MutationObserver, body: Node, root: Node, decide: () => void): () => void {
  let live = true;
  const observer = new Observer((records) => {
    if (live && records.some(isRelevantRecord)) decide();
  });
  observer.observe(body, { childList: true, subtree: true });
  observer.observe(root, { attributes: true, attributeFilter: ["data-cookie-consent"] });
  return () => {
    live = false;
    observer.disconnect();
  };
}
