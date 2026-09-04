import { EyebrowLabel, SkeletonBlock, SkeletonStatus } from "@/components/ui";

/**
 * The scholarships catalog, loading.
 *
 * Eyebrow and heading are both constants and both real.
 *
 * ── THE SEO LANDING PAGES UNDER THIS SEGMENT ──────────────────────────────
 *
 * /scholarships/fully-funded and /scholarships/degree/[level] inherit this
 * file, and that is fine but not ideal — they are a different page with a
 * different heading. They are left inheriting deliberately rather than
 * given bespoke skeletons: both are `force-dynamic` public landing pages
 * whose traffic arrives cold from a search result rather than from an
 * in-app nav click, so the boundary buys them much less than it buys the
 * routes reached from the masthead. If either starts being linked from
 * inside the app, give it its own.
 */
export default function ScholarshipsLoading() {
  return (
    <div className="flex flex-col gap-5">
      <SkeletonStatus>Loading scholarships…</SkeletonStatus>

      <div>
        <EyebrowLabel>Funding for your next degree</EyebrowLabel>
        <h1 className="mt-1.5 text-[26px]">Scholarships</h1>
      </div>

      {/* Deadlines coming up. */}
      <div>
        <EyebrowLabel size="sm">Deadlines coming up</EyebrowLabel>
        <div className="mt-3 flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-4 w-3/4" />
          ))}
        </div>
      </div>

      {/* Filter chips. */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-8 w-24" />
        ))}
      </div>

      {/*
        Scholarship rows are a classifieds-style list with a hairline between
        them rather than bordered cards — matching PublicScholarshipRow, so
        the list does not change shape when the real entries land.
      */}
      <div className="flex flex-col">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border-b border-line py-4">
            <SkeletonBlock className="h-4 w-2/3" />
            <SkeletonBlock className="mt-2 h-3 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
