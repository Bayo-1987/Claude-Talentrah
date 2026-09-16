import { EyebrowLabel, SkeletonBlock, SkeletonStatus } from "@/components/ui";

/**
 * Booking callback, loading. Its only child, book/callback/page.tsx, has a
 * constant eyebrow and heading (the page only renders once a payment
 * callback has already failed, so both strings are always the same).
 */
export default function MentorshipBookLoading() {
  return (
    <div className="flex flex-col gap-4">
      <SkeletonStatus>Loading…</SkeletonStatus>

      <div>
        <EyebrowLabel>Payment issue</EyebrowLabel>
        <h1 className="mt-2 font-display text-[26px]">Something didn&apos;t go through.</h1>
      </div>

      <SkeletonBlock className="h-11 w-40" />
    </div>
  );
}
