import { EyebrowLabel, SkeletonBlock, SkeletonCard, SkeletonStatus } from "@/components/ui";

/**
 * The scholarships list, loading. Eyebrow, heading and the "browsing is
 * free" copy are all constants in page.tsx, so they render for real; the
 * deadline-alert banner, filter bar, and the listings themselves are what
 * genuinely depend on a fetch.
 *
 * LIVES IN A (list) NESTED GROUP, SIBLING OF [id]/degree/[level]/
 * fully-funded/, not directly under scholarships/ — same reason
 * jobs/(feed)/loading.tsx isn't a bare jobs/loading.tsx: those three routes
 * each carry a live notFound() and a loading.tsx anywhere in their ancestor
 * chain would break that route's HTTP status the way #221 documented.
 * (list) is a route group — same URL (`/scholarships`), but a real sibling
 * boundary those routes never inherit.
 */
export default function ScholarshipsListLoading() {
  return (
    <div className="flex flex-col gap-5">
      <SkeletonStatus>Loading scholarships…</SkeletonStatus>

      <div>
        <EyebrowLabel>Funding for your next degree</EyebrowLabel>
        <h1 className="mt-1.5 text-[26px]">Scholarships</h1>
        <p className="mt-1 max-w-[620px] text-[14px] text-ink-soft">
          Browsing, saving and tracking are free and unlimited. Every listing links
          out to the official page — that page is always the authority on current terms.
        </p>
      </div>

      <SkeletonBlock className="h-11 w-full" />

      <div className="flex flex-col gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} lines={3} />
        ))}
      </div>
    </div>
  );
}
