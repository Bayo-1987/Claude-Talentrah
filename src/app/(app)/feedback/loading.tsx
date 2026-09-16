import { EyebrowLabel, SkeletonBlock, SkeletonStatus } from "@/components/ui";

/**
 * Feedback, loading. Eyebrow and heading are constants in page.tsx; the form
 * itself is the only thing that depends on a fetch (the caller's existing
 * account context), so it's the only part standing in.
 */
export default function FeedbackLoading() {
  return (
    <div className="flex flex-col gap-6">
      <SkeletonStatus>Loading the feedback form…</SkeletonStatus>

      <div className="flex flex-col gap-3">
        <EyebrowLabel>Feedback</EyebrowLabel>
        <h1 className="text-[30px] leading-[1.2]">Tell us what&apos;s not working.</h1>
      </div>

      <div className="flex flex-col gap-4">
        <SkeletonBlock className="h-11 w-full" />
        <SkeletonBlock className="h-32 w-full" />
        <SkeletonBlock className="h-11 w-32" />
      </div>
    </div>
  );
}
