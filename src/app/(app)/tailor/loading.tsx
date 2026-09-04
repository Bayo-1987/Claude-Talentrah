import { EyebrowLabel, SkeletonBlock, SkeletonStatus } from "@/components/ui";

/**
 * The tailoring page, loading.
 *
 * The eyebrow is constant and real. The heading is not: it reads either
 * `Tailor your resume to "<job title>"` or "Paste a job description"
 * depending on whether a job was passed in, and which of those is right is
 * one of the things being fetched.
 *
 * NOTE ON SCOPE — this covers the page ARRIVING, not a tailoring RUN. The
 * run itself is a client-side action with its own in-page pending state and
 * is untouched by this file; a `loading.tsx` only ever stands in for a
 * server render of the route.
 */
export default function TailorLoading() {
  return (
    <div className="flex flex-col gap-6">
      <SkeletonStatus>Loading the tailoring workspace…</SkeletonStatus>

      <div>
        <EyebrowLabel>Farah — tailor my resume</EyebrowLabel>
        <SkeletonBlock className="mt-3 h-7 w-2/3" />
        <div className="mt-3 flex flex-col gap-2">
          <SkeletonBlock className="h-3 w-full max-w-[600px]" />
          <SkeletonBlock className="h-3 w-4/5 max-w-[600px]" />
        </div>
      </div>

      {/* The paste-a-JD textarea and its submit. */}
      <div className="border-[1.5px] border-line bg-card p-4">
        <SkeletonBlock className="h-3 w-32" />
        <SkeletonBlock className="mt-3 h-40 w-full" />
        <SkeletonBlock className="mt-4 h-11 w-40" />
      </div>
    </div>
  );
}
