import { SkeletonBlock, SkeletonStatus } from "@/components/ui";

/**
 * Billing, loading.
 *
 * The eyebrow and the heading are constants now ("Talentrah billing" / "Billing": the page no longer changes them when a Pass is
 * active), so they are real text here. Everything that depends on the reader (the balance, the pass, the purchases) is a placeholder,
 * in the same shapes as the page so nothing reflows when the data arrives: an ink panel in three columns (stacked on a phone), then the
 * passes as a three-up row of cards, then the activity list and the credits list.
 */
export default function BillingLoading() {
  return (
    <div className="@container flex flex-col gap-10">
      <SkeletonStatus>Loading your credits and passes…</SkeletonStatus>

      <div>
        <span className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">Talentrah billing</span>
        <h1 className="mt-2 font-display text-[28px]">Billing</h1>
      </div>

      {/* The ink panel: balance, pass, top up. */}
      <div className="grid grid-cols-1 gap-5 bg-ink px-5 py-6 @[560px]:px-9 @[560px]:py-8 @[700px]:grid-cols-3 @[700px]:gap-8">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-3">
            <SkeletonBlock className="h-3 w-28" />
            <SkeletonBlock className="h-12 w-32" />
            <SkeletonBlock className="h-3 w-full" />
          </div>
        ))}
      </div>

      {/* Passes: a three-up grid of cards at desktop, stacked below it. */}
      <div>
        <span className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">Passes</span>
        <div className="mt-3 grid gap-4 @[620px]:grid-cols-3">
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

      {/* Recent activity. */}
      <div>
        <span className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">Recent activity</span>
        <div className="mt-3 flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-5 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
