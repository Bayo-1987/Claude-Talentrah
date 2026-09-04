import { SkeletonBlock, SkeletonCard, SkeletonStatus } from "@/components/ui";

/**
 * The employer shell's skeleton, covering every route under /employer that
 * has not got a more specific one.
 *
 * Same reasoning as (app)/loading.tsx — see that file for why a loading
 * boundary is what turns a nav click into something that visibly starts —
 * but a separate file, because this is a separate shell. The employer
 * masthead lives in employer/layout.tsx, outside this boundary, so it stays
 * painted across the navigation and is deliberately not drawn here.
 *
 * DELIBERATELY GENERIC, and more so than the seeker side. The routes under
 * here (Jobs Posted, Company Profile, Ad Campaigns) have quite different
 * layouts, and none of them shares the seeker app's eyebrow-plus-heading
 * convention closely enough for one skeleton to be faithful to all three.
 * Guessing at a shape they do not have would cause the layout jump this is
 * supposed to prevent, so this stays honest about knowing only that a page
 * is coming. A specific route that starts to feel slow should get its own
 * file beside its page.tsx.
 */
export default function EmployerLoading() {
  return (
    <div className="flex flex-col gap-6">
      <SkeletonStatus />
      <div>
        <SkeletonBlock className="h-3 w-28" />
        <SkeletonBlock className="mt-3 h-7 w-56" />
      </div>
      <div className="flex flex-col gap-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
