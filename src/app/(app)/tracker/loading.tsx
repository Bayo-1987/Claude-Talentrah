import { EyebrowLabel, SkeletonBlock, SkeletonStatus } from "@/components/ui";

/**
 * The Job Tracker, loading — for BOTH kinds of visitor since send-484, because a signed-out visitor now
 * reaches this route too (/tracker is a public landing page).
 *
 * So it carries nothing that is specific to either. It used to render `<h1>Job Tracker</h1>` and the
 * eyebrow "Every job, one place", both copied from the signed-in page: a signed-out visitor on a slow
 * connection read the signed-in heading first, and a streamed fallback lands in the RAW HTML, so the
 * placeholder <h1> plus the page's own made two <h1>s in the response a crawler reads.
 *
 * NO HEADING AT ALL, on purpose (e2e/jobs-tracker-public-landing.spec.ts asserts exactly one <h1> in the
 * raw bytes). The eyebrow is the name of the page, which is true for both.
 */
export default function TrackerLoading() {
  return (
    <div className="flex flex-col gap-5">
      <SkeletonStatus>Loading the job tracker…</SkeletonStatus>

      <EyebrowLabel>Job Tracker</EyebrowLabel>

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
