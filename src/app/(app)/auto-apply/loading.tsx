import { EyebrowLabel, SkeletonBlock, SkeletonStatus } from "@/components/ui";

/**
 * The Auto-Apply review queue, loading.
 *
 * Eyebrow and heading are both constants in page.tsx, so both are real. The
 * standing promise underneath them — nothing is submitted until you confirm
 * it — is deliberately NOT reproduced here: it names the live threshold
 * (AUTO_APPLY_MIN_SCORE), and a loading state is the last place that should
 * be able to drift from the real number. The queue rows below carry the
 * shape instead.
 */
export default function AutoApplyLoading() {
  return (
    <div className="flex flex-col gap-6">
      <SkeletonStatus>Loading your review queue…</SkeletonStatus>

      <div>
        <EyebrowLabel>Auto-Apply</EyebrowLabel>
        <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">
          Review queue
        </h1>
        <SkeletonBlock className="mt-3 h-3 w-2/3" />
      </div>

      {/* Queued matches awaiting confirmation. */}
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border-[1.5px] border-line bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <SkeletonBlock className="h-4 w-1/2" />
                <SkeletonBlock className="mt-2 h-3 w-1/3" />
              </div>
              <SkeletonBlock className="h-5 w-20 flex-shrink-0" />
            </div>
            <div className="mt-4 flex gap-2.5">
              <SkeletonBlock className="h-11 w-28" />
              <SkeletonBlock className="h-11 w-24" />
            </div>
          </div>
        ))}
      </div>

      {/* Activity log. */}
      <div>
        <EyebrowLabel>Activity log</EyebrowLabel>
        <div className="mt-3 flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-3 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
