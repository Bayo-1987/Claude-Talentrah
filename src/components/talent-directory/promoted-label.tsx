import { PROMOTED_LABEL } from "@/lib/talent-directory/promoted-label";

/**
 * "Promoted", drawn on a directory card whose candidate holds a seat in the Promoted strip (V5, 0268). Plain visible text, not a link or a control, so it is not in the tab order and a screen reader reads
 * it before the candidate's name. Solid --ink with paper text, like the job feed's "Sponsored" label (src/components/jobs/job-card.tsx) and for the same reason: the three match tiers own green, rust and
 * amber, and a fourth coloured pill would read as a fourth tier. It is 11px (the Editorial eyebrow size) where "Sponsored" is 10px, because this is the only thing on the card that says the position was paid for.
 * The text is the one constant in promoted-label.ts.
 */
export function PromotedLabel({ className = "" }: { className?: string }) {
  return (
    <span
      data-testid="promoted-label"
      className={`self-start bg-ink px-2 py-0.5 font-body text-[11px] font-bold tracking-[0.14em] text-paper uppercase ${className}`.trim()}
    >
      {PROMOTED_LABEL}
    </span>
  );
}
