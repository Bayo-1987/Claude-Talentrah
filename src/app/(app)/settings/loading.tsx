import { EyebrowLabel, SkeletonBlock, SkeletonCard, SkeletonStatus } from "@/components/ui";

/**
 * Settings, loading. Eyebrow and heading are constants in page.tsx, so both
 * render for real; the profile fields and account-actions card are the only
 * genuinely-fetched content.
 */
export default function SettingsLoading() {
  return (
    <div className="flex max-w-[620px] flex-col gap-6">
      <SkeletonStatus>Loading your settings…</SkeletonStatus>

      <div className="flex flex-col gap-2">
        <EyebrowLabel>Settings</EyebrowLabel>
        <h1 className="text-[30px] leading-[1.2]">Your profile</h1>
      </div>

      <SkeletonCard lines={3} />

      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1 border-b border-line pb-3">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
