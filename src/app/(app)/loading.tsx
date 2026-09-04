import { SkeletonBlock, SkeletonCard, SkeletonStatus } from "@/components/ui";

/**
 * The (app) group's fallback skeleton — what shows for any route in the
 * signed-in shell that has not got a more specific `loading.tsx` of its own.
 *
 * ── WHY EVERY SEGMENT NEEDS ONE OF THESE ──────────────────────────────────
 *
 * Without a loading file the App Router has nothing to swap in while a
 * server render is in flight, so it leaves the PREVIOUS page on screen
 * untouched until the new one is completely ready. On a route that takes
 * most of a second that is indistinguishable from a click that did not
 * register — which is exactly what was reported. A `loading.tsx` turns the
 * navigation into something that visibly starts.
 *
 * It also changes prefetching: Next.js prefetches a dynamic route only as
 * far as its nearest loading boundary, so before this file existed there was
 * no useful prefetch for any of these routes at all and every click began
 * cold.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * It does not re-render the masthead or the Farah panel. Those live in
 * (app)/layout.tsx, which is OUTSIDE this boundary and therefore stays
 * mounted and painted across the navigation — the shell does not flicker,
 * only the content column is replaced. Drawing a skeleton masthead here
 * would put a grey bar underneath the real one.
 *
 * Kept deliberately generic: a route with a distinctive layout should add
 * its own `loading.tsx` beside its `page.tsx` rather than making this file
 * try to be all of them at once.
 */
export default function AppLoading() {
  return (
    <div className="flex flex-col gap-6">
      <SkeletonStatus />
      <div>
        <SkeletonBlock className="h-3 w-32" />
        <SkeletonBlock className="mt-3 h-7 w-64" />
      </div>
      <div className="flex flex-col gap-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
