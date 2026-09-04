import { EyebrowLabel, SkeletonBlock, SkeletonStatus } from "@/components/ui";

/**
 * The Job Tracker, loading.
 *
 * Both the eyebrow and the heading are constants in page.tsx, so both are
 * rendered for real — the reader lands on a page that already says "Job
 * Tracker" while the rows are still being fetched.
 *
 * The five stage columns (Saved → Applied → Interviewing → Offer →
 * Rejected/Archived) are the tracker's whole structure and do not depend on
 * the data, so their headings hold their positions and only the entries
 * inside them settle.
 */
export default function TrackerLoading() {
  return (
    <div className="flex flex-col gap-5">
      <SkeletonStatus>Loading your job tracker…</SkeletonStatus>

      <div>
        <EyebrowLabel>Every job, one place</EyebrowLabel>
        <h1 className="mt-1.5 text-[26px]">Job Tracker</h1>
      </div>

      {/* The manual-entry form. */}
      <SkeletonBlock className="h-12 w-full" />

      <div className="flex flex-col gap-4">
        {Array.from({ length: 4 }).map((_, col) => (
          <div key={col} className="border-[1.5px] border-line bg-card p-4">
            <SkeletonBlock className="h-3.5 w-32" />
            <div className="mt-3.5 flex flex-col gap-2.5">
              {Array.from({ length: 2 }).map((_, row) => (
                <div key={row} className="flex items-center justify-between gap-4">
                  <SkeletonBlock className="h-4 w-1/2" />
                  <SkeletonBlock className="h-4 w-20 flex-shrink-0" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
