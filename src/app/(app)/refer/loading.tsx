import { EyebrowLabel, SkeletonBlock, SkeletonStatus } from "@/components/ui";

/**
 * Refer & Earn, loading — for BOTH kinds of visitor since send-515, because a signed-out visitor now reaches this route too (/refer is a
 * public landing page).
 *
 * The eyebrow is a constant and is rendered for real. There is NO HEADING at all, on purpose: a streamed fallback lands in the RAW HTML, so
 * a placeholder <h1> plus the page's own would be two <h1>s in the response a crawler reads, and the status text names neither a link nor
 * a signed-in state. (The old heading interpolated the reward, which would also have been a second place to keep in step with the page.)
 *
 * Nothing on this page is a live-updating figure, so the skeleton is
 * short-lived; its job is mainly to prove the click landed.
 */
export default function ReferLoading() {
  return (
    <div className="flex flex-col gap-6">
      <SkeletonStatus>Loading Refer &amp; earn…</SkeletonStatus>

      <div>
        <EyebrowLabel>Refer &amp; earn</EyebrowLabel>
        <SkeletonBlock className="mt-3 h-7 w-3/4" />
        <SkeletonBlock className="mt-3 h-3 w-2/3" />
      </div>

      {/* The share link box and its WhatsApp-first share row. */}
      <div className="border-[1.5px] border-line bg-card p-4">
        <SkeletonBlock className="h-3 w-20" />
        <SkeletonBlock className="mt-3 h-11 w-full" />
        <div className="mt-3 flex flex-wrap gap-2.5">
          <SkeletonBlock className="h-11 w-32" />
          <SkeletonBlock className="h-11 w-28" />
        </div>
      </div>

      {/* The invited → signed up → activated → rewarded funnel. */}
      <div className="border-[1.5px] border-line bg-card p-4">
        <SkeletonBlock className="h-3 w-28" />
        <div className="mt-3.5 grid grid-cols-2 gap-4 min-[760px]:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <SkeletonBlock className="h-7 w-12" />
              <SkeletonBlock className="mt-2 h-3 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
