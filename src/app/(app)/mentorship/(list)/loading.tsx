import { Container, EyebrowLabel, SkeletonCard, SkeletonStatus } from "@/components/ui";

/**
 * Mentor discovery, loading. Eyebrow, heading and intro copy are constants
 * in page.tsx; the mentor cards are the only genuinely-fetched content.
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

      <div className="flex flex-col gap-2">
        <EyebrowLabel>Mentorship</EyebrowLabel>
        <h1 className="font-display text-[28px] font-semibold">
          Talk to someone who&apos;s done it.
        </h1>
        <p className="max-w-[560px] text-[14.5px] text-ink-soft">
          Farah can benchmark and coach — a human mentor is for the moments
          that carry real stakes: a mock interview, a negotiation for a
          specific offer, or a second opinion on your resume from someone
          who&apos;s hired.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} lines={2} />
        ))}
      </div>
    </Container>
  );
}
