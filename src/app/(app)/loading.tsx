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
 *
 * ── RESTORED, NOT NEW ──────────────────────────────────────────────────────
 *
 * This exact file existed once (#218) and was removed (#221) because it
 * broke `notFound()`/`redirect()` status codes on routes underneath it that
 * needed one of those to run correctly. The routes that genuinely needed
 * that — every page with a live `notFound()` that a signed-out visitor can
 * reach directly — have since moved to a sibling `(public)` route group
 * that shares no ancestor with this file (see that group's own layout.tsx).
 * This file is safe again because that split, not because anything about
 * loading.tsx's own behaviour changed.
 *
 * TWO KNOWN, DELIBERATE EXCEPTIONS remain under (app) and DO regress the
 * same way #221 originally found, now that this file exists again:
 * `mentorship/[mentorId]` gates itself with a page-level `requireUser()`
 * call rather than through `seekerAppGate`, so it is not genuinely public
 * and does not belong in `(public)` — fixing it means touching
 * `seekerAppGate` or deciding mentor profiles should be public, neither of
 * which this restoration was scoped to do. `tracker/[applicationId]/sent`
 * was ALREADY affected before this file existed at all, via
 * `tracker/loading.tsx`'s own closer ancestor boundary — confirmed by
 * direct request, independent of this restoration, not caused by it.
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
