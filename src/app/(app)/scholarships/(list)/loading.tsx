import { EyebrowLabel, SkeletonBlock, SkeletonCard, SkeletonStatus } from "@/components/ui";

/**
 * The scholarships list, loading — and the FIRST thing a visitor on a slow connection reads,
 * for BOTH kinds of visitor: since send-480 a signed-out visitor reaches this route too.
 *
 * So it carries nothing that is specific to either. It used to render the signed-in heading and
 * "Browsing, saving and tracking are free and unlimited", which (a) told a signed-out visitor
 * the wrong page, (b) scoped "free" wrongly — saving and tracking need an account — and (c)
 * then jumped to a different, taller page. Measured on production /mentorship, which has the
 * same shape: on a throttled mobile profile the signed-in heading is what a signed-out visitor
 * sees first (0.9 s on Fast 3G, 1.5 s on Slow 3G), then a different <h1> replaces it.
 *
 * NO HEADING AT ALL, on purpose: a streamed loading fallback lands in the RAW HTML next to the
 * page, so a placeholder <h1> plus the page's own <h1> is two <h1>s in the response a crawler
 * reads (e2e/scholarships-public-landing.spec.ts asserts exactly one, in the raw bytes).
 *
 * LIVES IN A (list) NESTED GROUP, SIBLING OF [id]/degree/[level]/fully-funded/, not directly
 * under scholarships/ — same reason jobs/(feed)/loading.tsx isn't a bare jobs/loading.tsx:
 * those three routes each carry a live notFound() and a loading.tsx anywhere in their ancestor
 * chain would break that route's HTTP status the way #221 documented. (list) is a route group —
 * same URL (`/scholarships`), but a real sibling boundary those routes never inherit.
 */
export default function ScholarshipsListLoading() {
  return (
    <div className="flex flex-col gap-5">
      <SkeletonStatus>Loading scholarships…</SkeletonStatus>

      <EyebrowLabel>Scholarships</EyebrowLabel>

      <SkeletonBlock className="h-11 w-full" />

      <div className="flex flex-col gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} lines={3} />
        ))}
      </div>
    </div>
  );
}
