import { SkeletonBlock, SkeletonStatus } from "@/components/ui";

/**
 * Billing, loading.
 *
 * NO REAL EYEBROW HERE, unlike the tracker and the feed — and the reason is
 * worth naming so nobody "fixes" it later. Billing's eyebrow is
 * `{leadingPass ? "Your Pass" : "Talentrah Credits"}`: which of the two it
 * says depends on whether the reader holds an active Pass, which is
 * precisely what this page is still fetching. Guessing would mean showing a
 * reader "Your Pass" and then taking it away, which is a worse thing to do
 * on a money page than showing a placeholder for a moment.
 *
 * The section headings below it (Credit packs, Passes) are constants, so
 * those are real.
 */
export default function BillingLoading() {
  return (
    <div className="flex flex-col gap-6">
      <SkeletonStatus>Loading your credits and passes…</SkeletonStatus>

      <div>
        <SkeletonBlock className="h-3 w-36" />
        <SkeletonBlock className="mt-3 h-8 w-56" />
      </div>

      {/* Balance / active pass panel. */}
      <div className="border-[1.5px] border-line bg-card p-4">
        <SkeletonBlock className="h-3.5 w-40" />
        <SkeletonBlock className="mt-3 h-6 w-32" />
      </div>

      {/*
        Credit packs and Passes are a three-up grid of purchase cards at
        desktop and stacked below it, matching the real page — so the row
        does not reflow when the prices arrive.
      */}
      {["Credit packs", "Passes"].map((section) => (
        <div key={section}>
          <span className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            {section}
          </span>
          <div className="mt-3 grid gap-4 min-[760px]:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="border-[1.5px] border-line bg-card p-4">
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="mt-3 h-7 w-20" />
                <SkeletonBlock className="mt-3 h-3 w-full" />
                <SkeletonBlock className="mt-4 h-11 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
