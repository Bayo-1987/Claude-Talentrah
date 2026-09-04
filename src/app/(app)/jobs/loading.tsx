import { EyebrowLabel, SkeletonBlock, SkeletonStatus } from "@/components/ui";

/**
 * The job feed's skeleton.
 *
 * THE EYEBROW IS REAL, NOT A GREY BLOCK. "Today's board" is a constant
 * string in page.tsx — it needs no database — so rendering it for real
 * means the reader sees the page they asked for identify itself
 * immediately, and the swap to real content changes only the cards. That is
 * the difference between a skeleton and a spinner: a spinner discards
 * information the server already had.
 *
 * The card count is a guess at a first screenful, not a prediction of the
 * result set. Six is roughly what fits above the fold at desktop; fewer
 * would leave the column looking empty mid-load and more would push a tall
 * grey field below the fold for no gain.
 *
 * The measurements mirror JobCard's own: a 1.5px `--line` border on
 * `--card`, `p-5`, a 44×44 company badge, a title row, three lines of
 * clipped description, and a footer above a hairline. Matching the real
 * card's box means the cards do not jump when they arrive.
 */
function JobCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3.5 border-[1.5px] border-line bg-card p-5">
      <div className="flex items-start gap-4">
        {/* The 44×44 two-letter company badge. */}
        <SkeletonBlock className="h-11 w-11 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-4">
            <SkeletonBlock className="h-5 w-2/5" />
            {/* Match tier badge. */}
            <SkeletonBlock className="h-5 w-20 flex-shrink-0" />
          </div>
          <SkeletonBlock className="mt-2 h-3 w-3/5" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <SkeletonBlock className="h-3 w-full" />
        <SkeletonBlock className="h-3 w-full" />
        <SkeletonBlock className="h-3 w-4/5" />
      </div>
      <div className="flex items-center justify-between border-t border-line pt-3.5">
        <SkeletonBlock className="h-3 w-28" />
        <div className="flex items-center gap-2.5">
          {/* The two 40×40 circular icon buttons are the one place a radius
              is allowed, so the placeholders are round here too. */}
          <SkeletonBlock className="h-10 w-10 rounded-full" />
          <SkeletonBlock className="h-10 w-10 rounded-full" />
          <SkeletonBlock className="h-10 w-24" />
        </div>
      </div>
    </div>
  );
}

export default function JobsLoading() {
  return (
    <div className="flex flex-col gap-5">
      <SkeletonStatus>Loading your job board…</SkeletonStatus>

      {/*
        Matches the fixed feed header's own `-mt-8 pt-8 bg-paper` trick — see
        page.tsx's note on why: (app)/layout.tsx wraps this in py-8, and
        without pulling that padding back the header sits 32px lower here
        than it does on the loaded page, so the whole column visibly jumps
        when the real content arrives.
      */}
      <div className="-mt-8 bg-paper pt-8">
        <EyebrowLabel>Today&apos;s board</EyebrowLabel>
        {/* The four tabs: Recommended / External / Most Recent / Saved. */}
        <div className="mt-2 flex gap-5">
          <SkeletonBlock className="h-5 w-28" />
          <SkeletonBlock className="h-5 w-20" />
          <SkeletonBlock className="h-5 w-24" />
          <SkeletonBlock className="h-5 w-16" />
        </div>
      </div>

      {/* The Auto-Apply card and the filter bar, which scroll with the page. */}
      <SkeletonBlock className="h-20 w-full" />
      <div className="flex flex-col gap-3">
        <SkeletonBlock className="h-11 w-full" />
        <div className="flex flex-wrap gap-2">
          <SkeletonBlock className="h-8 w-24" />
          <SkeletonBlock className="h-8 w-28" />
          <SkeletonBlock className="h-8 w-20" />
          <SkeletonBlock className="h-8 w-32" />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <JobCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
