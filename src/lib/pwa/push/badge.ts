/**
 * The page-side app badge: one function, so every caller does the same thing and the badge always equals the unread count.
 *
 * `syncBadge(count)` sets the app badge to exactly `count`, clears it at zero, and ignores anything that is not a non-negative whole number (a bad value must
 * never blank a real badge). It never throws and never rejects: a browser without the Badging API, or one that refuses the call, is not an error.
 *
 * Callers (wired by the inbox packages, not here): on load, on `visibilitychange`, and after every code path that writes `read_at`. The count is NOT capped at 9:
 * the "9+" is the bell's own text; the badge shows the real number. A closed app's badge only changes at the next push or the next open (a silent push is excluded
 * by design), and the notification's own copy says so.
 *
 * The worker sets the same badge from a push payload's numeric `badge` field (src/lib/pwa/service-worker-source.ts); this is the page's half.
 */
export interface BadgeNavigator {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

export async function syncBadge(
  count: number,
  nav: BadgeNavigator | undefined = typeof navigator === "undefined" ? undefined : (navigator as BadgeNavigator),
): Promise<void> {
  if (!nav || typeof count !== "number" || !Number.isInteger(count) || count < 0) return;
  try {
    if (count > 0) {
      if (typeof nav.setAppBadge === "function") await nav.setAppBadge(count);
    } else if (typeof nav.clearAppBadge === "function") {
      await nav.clearAppBadge();
    }
  } catch {
    // The browser refused, or the call threw: nothing to do, and nothing worth reporting to the person.
  }
}
