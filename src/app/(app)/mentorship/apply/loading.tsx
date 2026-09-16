import { Container, EyebrowLabel, SkeletonBlock, SkeletonCard, SkeletonStatus } from "@/components/ui";

/**
 * Mentor application/profile, loading. Eyebrow is a constant in page.tsx;
 * the heading itself depends on whether the caller already has a mentor
 * profile ("Become a mentor" vs. "Your mentor profile") — genuinely fetched,
 * so a skeleton block stands in rather than guessing which string to show.
 */
export default function MentorApplyLoading() {
  return (
    <Container className="flex max-w-[640px] flex-col gap-8 py-12">
      <SkeletonStatus>Loading your mentor application…</SkeletonStatus>

      <div>
        <EyebrowLabel>Mentorship</EyebrowLabel>
        <SkeletonBlock className="mt-2 h-7 w-56" />
      </div>

      <SkeletonCard lines={4} />
    </Container>
  );
}
