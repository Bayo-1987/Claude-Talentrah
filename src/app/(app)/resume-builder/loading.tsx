import { EyebrowLabel, SkeletonBlock, SkeletonStatus } from "@/components/ui";

/**
 * The Resume Builder's start page, loading.
 *
 * Eyebrow and heading are both constants in page.tsx, so both are real.
 * What follows is the reader's own saved resumes and then the template
 * gallery — the gallery is a grid, so its cells hold their positions and
 * the page does not reflow when the templates arrive.
 *
 * Covers this segment's nested routes (/new, /edit) too unless they add
 * their own file. /edit is the heavier of the two and would be the next
 * candidate for a bespoke skeleton if it starts to feel slow.
 */
export default function ResumeBuilderLoading() {
  return (
    <div className="flex flex-col gap-6">
      <SkeletonStatus>Loading the Resume Builder…</SkeletonStatus>

      <div>
        <EyebrowLabel>Resume Builder</EyebrowLabel>
        <h1 className="mt-2 font-display text-[28px]">Build a resume that fits the role.</h1>
      </div>

      {/* Your resumes. */}
      <div>
        <EyebrowLabel size="sm">Your resumes</EyebrowLabel>
        <div className="mt-3 flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-4 border-[1.5px] border-line bg-card p-4"
            >
              <div className="min-w-0 flex-1">
                <SkeletonBlock className="h-4 w-2/5" />
                <SkeletonBlock className="mt-2 h-3 w-24" />
              </div>
              <SkeletonBlock className="h-11 w-24 flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>

      {/* Template gallery. */}
      <div>
        <EyebrowLabel size="sm">Template gallery</EyebrowLabel>
        <div className="mt-3 grid gap-4 min-[760px]:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border-[1.5px] border-line bg-card p-3">
              {/* The template preview thumbnail — a page, so portrait. */}
              <SkeletonBlock className="aspect-[3/4] w-full" />
              <SkeletonBlock className="mt-3 h-3.5 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
