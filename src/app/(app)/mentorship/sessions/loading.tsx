import { EyebrowLabel, SkeletonBlock, SkeletonCard, SkeletonStatus } from "@/components/ui";

/**
 * Sessions, loading. Covers both the mentee's own view (sessions/page.tsx,
 * heading "Your sessions") and a mentor's view of their mentees
 * (sessions/mentor/page.tsx, heading "Your mentees") — safe to share, since
 * neither calls notFound(). The eyebrow ("Mentorship") is constant across
 * both; the heading is not, so it's a generic block.
 */
export default function MentorshipSessionsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <SkeletonStatus>Loading sessions…</SkeletonStatus>

      <div>
        <EyebrowLabel>Mentorship</EyebrowLabel>
        <SkeletonBlock className="mt-2 h-7 w-48" />
      </div>

      <div className="flex flex-col gap-4">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </div>
    </div>
  );
}
