"use client";

import { useOptimistic, useTransition } from "react";
import { setSelfPausedAction } from "@/lib/mentorship/actions";

/**
 * Same round-switch affordance as reviews-verifications-toggle.tsx (CLAUDE.md's
 * own circular-affordance exception). Distinct copy from an admin suspension
 * on purpose — self-pause is the mentor's own choice, not discipline, and the
 * two must never read as the same thing.
 */
export function SelfPauseToggle({ paused }: { paused: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [optimisticPaused, setOptimisticPaused] = useOptimistic(paused);

  return (
    <div className="flex items-center justify-between gap-4">
      <p className="max-w-[48ch] font-body text-[13.5px] text-ink-soft">
        {optimisticPaused
          ? "Your listing is paused — toggle it back on anytime."
          : "Pause your listing to stop taking new bookings, without losing your profile or reviews."}
      </p>
      <button
        type="button"
        role="switch"
        aria-checked={optimisticPaused}
        aria-label="Pause your mentor listing"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setOptimisticPaused(!paused);
            await setSelfPausedAction(!paused);
          })
        }
        className={[
          "relative inline-flex h-[26px] w-[46px] flex-shrink-0 items-center rounded-full border-[1.5px] border-ink transition-colors",
          optimisticPaused ? "bg-ink" : "bg-paper",
          isPending ? "opacity-50" : "",
        ].join(" ")}
      >
        <span
          className={[
            "inline-block h-[16px] w-[16px] rounded-full transition-transform",
            optimisticPaused ? "translate-x-[25px] bg-paper" : "translate-x-[4px] bg-ink",
          ].join(" ")}
        />
      </button>
    </div>
  );
}
