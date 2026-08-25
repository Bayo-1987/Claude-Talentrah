"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { setAutoApplyEnabledAction } from "@/lib/auto-apply/actions";
import { AUTO_APPLY_DAILY_SUBMIT_CAP, AUTO_APPLY_MIN_SCORE } from "@/lib/auto-apply/config";

/**
 * Auto-Apply toggle, in the job feed per build-prompt §6.2.
 *
 * The copy carries the whole product position. §2.3 calls this "a trust
 * feature, not a volume feature", so the control says what it will and won't do
 * *before* it is switched on — Excellent-only, review-first, capped — rather
 * than presenting an unqualified "Auto-Apply: ON" and explaining the limits
 * somewhere the user has to go looking.
 *
 * The round switch is one of the few circular affordances the design system
 * allows (CLAUDE.md: no border-radius except avatars, notification dots and
 * toggle switches).
 */
export function AutoApplyToggle({
  enabled,
  pendingCount,
}: {
  enabled: boolean;
  pendingCount: number;
}) {
  const [isPending, startTransition] = useTransition();
  /*
   * The switch reflects an optimistic value, not the server prop directly.
   *
   * Turning Auto-Apply ON also runs the first queue scan, which is several
   * database round-trips — so the action takes long enough that a switch bound
   * straight to the server prop sits visibly unmoved after the click, looking
   * broken. The optimistic value flips immediately and is reconciled by the
   * re-render that `revalidatePath` triggers; if the action fails, React
   * discards it and the switch snaps back, which is the correct outcome.
   */
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(enabled);

  return (
    <div className="flex flex-col gap-2 border-[1.5px] border-ink bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-[17px] font-semibold text-ink">Auto-Apply</h2>
            <span className="border border-line px-1.5 py-0.5 font-body text-[10.5px] font-bold tracking-[0.14em] text-ink-soft uppercase">
              Review first
            </span>
          </div>
          <p className="mt-1 max-w-[62ch] font-body text-[13.5px] text-ink-soft">
            Queues roles that score <span className="font-semibold text-ink">Excellent</span> ({AUTO_APPLY_MIN_SCORE}
            %+) against your resume. Nothing is sent until you confirm it, and never more than{" "}
            {AUTO_APPLY_DAILY_SUBMIT_CAP} a day.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={optimisticEnabled}
          aria-label="Auto-Apply"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setOptimisticEnabled(!enabled);
              await setAutoApplyEnabledAction(!enabled);
            })
          }
          className={[
            "relative inline-flex h-[26px] w-[46px] flex-shrink-0 items-center rounded-full border-[1.5px] border-ink transition-colors",
            optimisticEnabled ? "bg-ink" : "bg-paper",
            isPending ? "opacity-50" : "",
          ].join(" ")}
        >
          <span
            className={[
              "inline-block h-[16px] w-[16px] rounded-full transition-transform",
              optimisticEnabled ? "translate-x-[25px] bg-paper" : "translate-x-[4px] bg-ink",
            ].join(" ")}
          />
        </button>
      </div>

      {enabled && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-2.5">
          <Link
            href="/auto-apply"
            className="font-body text-[13.5px] font-semibold text-rust underline underline-offset-2"
          >
            {pendingCount > 0
              ? `${pendingCount} ${pendingCount === 1 ? "match is" : "matches are"} waiting for review`
              : "Review queue"}
          </Link>
          <span className="font-body text-[12.5px] text-ink-soft">
            Nothing is submitted from here — you confirm each one.
          </span>
        </div>
      )}
    </div>
  );
}
