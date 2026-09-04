import { SkeletonBlock, SkeletonStatus } from "@/components/ui";

/**
 * A single job posting, loading.
 *
 * Nothing here is a real string: unlike the feed, every word on this page —
 * title, company, the whole description — comes from the posting, so there
 * is nothing to paint early except its shape.
 *
 * WORTH HAVING ANYWAY, and arguably more than anywhere else in the app.
 * This is the route reached by tapping a card, which is the most-clicked
 * link in the product; without a boundary here the feed simply sat there
 * after the tap. It is also a PUBLIC page (signed-out readers and Googlebot
 * get it), so the skeleton is what a cold visitor from a search result sees
 * first.
 */
export default function JobDetailLoading() {
  return (
    <div className="flex max-w-[820px] flex-col gap-6">
      <SkeletonStatus>Loading this job…</SkeletonStatus>

      {/* Back link. */}
      <SkeletonBlock className="h-4 w-32" />

      <div className="flex items-start gap-4">
        {/* Company badge, same 44×44 square as the card it was tapped from. */}
        <SkeletonBlock className="h-11 w-11 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <SkeletonBlock className="h-8 w-3/4" />
          <SkeletonBlock className="mt-3 h-3 w-1/2" />
        </div>
      </div>

      {/* Match score panel and the apply row. */}
      <div className="border-[1.5px] border-line bg-card p-4">
        <SkeletonBlock className="h-4 w-28" />
        <SkeletonBlock className="mt-3 h-10 w-40" />
      </div>

      {/* The description itself — the tall part of this page. */}
      <div className="flex flex-col gap-2.5">
        {[
          "w-full", "w-full", "w-11/12", "w-full", "w-4/5",
          "w-full", "w-full", "w-3/4", "w-full", "w-2/3",
        ].map((w, i) => (
          <SkeletonBlock key={i} className={`h-3 ${w}`} />
        ))}
      </div>
    </div>
  );
}
