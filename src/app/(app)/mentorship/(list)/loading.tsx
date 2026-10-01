import { Container, EyebrowLabel, SkeletonCard, SkeletonStatus } from "@/components/ui";

/**
 * Mentor discovery, loading — for BOTH kinds of visitor. Since send-385 a signed-out visitor reaches this
 * route too, so it carries nothing specific to either.
 *
 * send-487 — it used to render the signed-in page's heading ("Talk to someone who's done it.") and intro
 * paragraph. MEASURED (send-480, on this route): on a throttled mobile profile a signed-out visitor read that
 * signed-in heading first (0.9 s on Fast 3G, 1.5 s on Slow 3G) before a different <h1> replaced it; and a
 * streamed fallback lands in the RAW HTML beside the page, so the response a crawler reads had TWO <h1>s
 * (production, probed signed out: the signed-in one at byte 4458, the landing's at 96864).
 *
 * NO HEADING AT ALL, on purpose: eyebrow + status + skeleton cards, the same neutral shape as
 * scholarships/(list)/loading.tsx, jobs/(feed)/loading.tsx and tracker/(list)/loading.tsx
 * (tests/mentorship/list-loading.test.tsx; e2e/mentorship-public-landing.spec.ts counts the raw <h1>s).
 * The `Container` wrapper stays so the signed-in loading-to-page transition does not shift.
 *
 * LIVES IN A (list) NESTED GROUP, SIBLING OF [mentorId]/, not directly under
 * mentorship/ — same reason jobs/(feed)/loading.tsx isn't a bare
 * jobs/loading.tsx: [mentorId] carries a live notFound() for a nonexistent
 * mentor, and a loading.tsx anywhere in its ancestor chain would break that
 * route's HTTP status the way #221 documented. (list) is a route group —
 * same URL (`/mentorship`), but a real sibling boundary [mentorId] never
 * inherits. Note this is a SEPARATE concern from seekerAppGate's own
 * protection of /mentorship (added alongside this restoration): that fixes
 * the signed-out REDIRECT, this route-group split fixes the signed-in
 * NOT-FOUND status, and both were needed.
 */
export default function MentorshipListLoading() {
  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <SkeletonStatus>Loading mentors…</SkeletonStatus>

      <EyebrowLabel>Mentorship</EyebrowLabel>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} lines={2} />
        ))}
      </div>
    </Container>
  );
}
