import { EyebrowLabel, SkeletonBlock, SkeletonStatus } from "@/components/ui";

/**
 * The jobs feed, loading — masthead-logo and tab-row clicks both land here.
 *
 * ── WHY THIS FILE LIVES UNDER A (feed) ROUTE GROUP, NOT DIRECTLY IN jobs/ ───
 *
 * `jobs/loading.tsx` existed once (#218) and was removed (#221) because a
 * `loading.tsx` anywhere in a segment's ancestor chain makes Next commit to
 * HTTP 200 the instant it decides the route CAN stream — before
 * `jobs/[id]/page.tsx`'s own `notFound()` ever runs. As a direct ancestor, it
 * broke `/jobs/[id]`'s 404 for a missing/expired/private job exactly the same
 * way `(app)/loading.tsx` broke it at the root (see #221's PR description and
 * e2e/nav-responsiveness.spec.ts's own header for the full, measured history —
 * read both before touching this).
 *
 * `(feed)` is a route group: it changes nothing about the URL (this still
 * resolves to `/jobs`, the same reason `(app)` and `(marketing)` don't appear
 * in any URL either), but it DOES create a real boundary in the segment tree.
 * `jobs/[id]` sits at `jobs/[id]/`, a SIBLING of `jobs/(feed)/`, not a child
 * of it — so this loading boundary has no effect on that route's ancestry,
 * and `notFound()` there is exactly as unaffected as it was with no
 * `jobs/loading.tsx` at all. Verified directly, not assumed — see this PR's
 * own description for the real e2e run confirming `/jobs/[id]`'s 404 status
 * is unchanged.
 *
 * ── WHY THE BODY IS NEUTRAL (send-484) ──────────────────────────────────────
 *
 * Since send-484 a SIGNED-OUT visitor reaches this route too (/jobs is a public landing page), so this
 * fallback is correct for both visitors and specific to neither. It used to sketch the signed-in page:
 * a four-tab row, an Auto-Apply toggle block, a filter bar, "Today's board" and "Loading your jobs feed…"
 * — which told a signed-out visitor the wrong page and then jumped to a different, taller one.
 *
 * NO HEADING AT ALL, on purpose: a streamed loading fallback lands in the RAW HTML next to the page, so a
 * placeholder <h1> plus the page's own is two <h1>s in the response a crawler reads
 * (e2e/jobs-tracker-public-landing.spec.ts asserts exactly one, in the raw bytes). The tab row and toggle
 * block are gone for the same reason they were wrong: they are signed-in chrome.
 *
 * ── WHAT THIS DOES NOT FIX, AND WHY THAT'S A SEPARATE DECISION ─────────────
 *
 * e2e/nav-responsiveness.spec.ts (skipped, not deleted) documents a second,
 * broader finding: with no ROOT (app)/loading.tsx, EVERY client-side nav in
 * the signed-in app is slow to paint anything — even a destination with its
 * own loading.tsx measured 657ms instead of the tens-of-ms a working root
 * boundary gives everywhere. This file does not attempt that fix; it is
 * scoped narrowly to the one route this task is about. If a real trace (see
 * this PR's own verification) shows this boundary is ALSO slow to engage for
 * the same underlying reason, that is the skipped test's finding recurring
 * here, not a new bug — and the real fix is the root-level architecture
 * decision that test's own comment describes, not a local band-aid on this
 * file.
 */
export default function JobsFeedLoading() {
  return (
    <div className="flex flex-col gap-5">
      <SkeletonStatus>Loading jobs…</SkeletonStatus>

      <EyebrowLabel>Jobs</EyebrowLabel>

      <SkeletonBlock className="h-11 w-full" />

      {/*
        Job rows. Same BorderedCard shape (1.5px border, no radius, --card ground, p-5) as the real
        cards, so the swap to actual content does not shift the page much — five is a reasonable
        above-the-fold count on a typical viewport, not a claim about how many will actually render.
      */}
      <div className="flex flex-col gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border-[1.5px] border-line bg-card p-5">
            <div className="flex items-start gap-4">
              <SkeletonBlock className="h-11 w-11 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <SkeletonBlock className="h-[17px] w-2/5" />
                <SkeletonBlock className="mt-2 h-3 w-3/5" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
