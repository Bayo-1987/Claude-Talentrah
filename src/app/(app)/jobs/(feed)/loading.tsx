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
      <SkeletonStatus>Loading your jobs feed…</SkeletonStatus>

      <div>
        <EyebrowLabel>Today&apos;s board</EyebrowLabel>
        {/*
          A NEUTRAL tab row, not the real FeedTabs component. loading.tsx has
          no access to searchParams in the App Router — there is no way to
          know which tab was actually clicked — so rendering FeedTabs with a
          guessed `active` value would show the WRONG tab underlined for a
          beat, then snap to the right one once real content arrives. That is
          a more jarring flash than showing none highlighted at all, which is
          the honest state: "a tab row is coming," not "here is which one."
          Same shape (gap-6, min-h-10, border-b) as the real component so the
          row's height and position don't shift once it's replaced.

          `overflow-x-hidden` on the wrapper, deliberately, not just tidiness:
          four `w-20` blocks plus three `gap-6`s are 392px of intrinsic
          content — wider than a 360px phone viewport (CLAUDE.md's own
          low-end-Android constraint) — and unlike the real FeedTabs' text,
          which is short enough to fit, a fixed-width placeholder has no
          content-driven reason to shrink. Measured directly: without this,
          `document.scrollWidth` on a 360px viewport was 416px, a real
          horizontal-scroll bug for the split second this skeleton is on
          screen. Clipping is harmless here — it's a decorative placeholder,
          not fully-visible real information.
        */}
        <div className="mt-2 flex items-center gap-6 overflow-x-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex min-h-10 flex-shrink-0 items-center border-b-[2.5px] border-transparent"
            >
              <SkeletonBlock className="h-3.5 w-20" />
            </div>
          ))}
        </div>
      </div>

      {/*
        Auto-Apply toggle + filter bar's own rough shape — both are constant
        chrome (a toggle switch, a search box, filter chips), never database
        content, so a close approximation here costs nothing and holds the
        page's real proportions.
      */}
      <div className="flex flex-col gap-5">
        <SkeletonBlock className="h-[72px] w-full" />
        <SkeletonBlock className="h-11 w-full" />
      </div>

      {/*
        Job cards. Same BorderedCard shape (1.5px border, no radius, --card
        ground, p-5) as the real thing, so the swap to actual cards doesn't
        shift the page — five is a reasonable above-the-fold count on a
        typical viewport, not a claim about how many will actually render.
      */}
      <div className="flex flex-col gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border-[1.5px] border-line bg-card p-5">
            <div className="flex items-start gap-4">
              <SkeletonBlock className="h-11 w-11 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <SkeletonBlock className="h-[17px] w-2/5" />
                  <SkeletonBlock className="h-4 w-24 flex-shrink-0" />
                </div>
                <SkeletonBlock className="mt-2 h-3 w-3/5" />
              </div>
            </div>
            <div className="mt-3.5 flex gap-2.5">
              <SkeletonBlock className="h-9 w-24" />
              <SkeletonBlock className="h-9 w-9" />
              <SkeletonBlock className="h-9 w-9" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
