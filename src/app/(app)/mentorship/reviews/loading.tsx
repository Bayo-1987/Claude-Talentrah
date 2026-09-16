import { Container, EyebrowLabel, SkeletonBlock, SkeletonCard, SkeletonStatus } from "@/components/ui";

/**
 * Verification reviews, loading. Covers both the review queue
 * (reviews/page.tsx, heading "Verification reviews") and a single
 * verification's own page (reviews/[verificationId]/page.tsx, heading
 * "Reviewing {name}" or "Not available") — safe to share, since NEITHER
 * calls notFound(). The eyebrow ("Talent Directory") is constant across
 * both; the heading is not, so it's a generic block rather than a specific
 * string that would be wrong for one of the two pages.
 */
export default function MentorshipReviewsLoading() {
  return (
    <Container className="flex max-w-[720px] flex-col gap-8 py-12">
      <SkeletonStatus>Loading reviews…</SkeletonStatus>

      <div>
        <EyebrowLabel>Talent Directory</EyebrowLabel>
        <SkeletonBlock className="mt-2 h-7 w-64" />
      </div>

      <div className="flex flex-col gap-4">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </div>
    </Container>
  );
}
