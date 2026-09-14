"use client";

import { useOptimistic, useTransition } from "react";
import { setReviewsVerificationsOptInAction } from "@/lib/mentorship/actions";

/**
 * Same round-switch affordance as talent-directory's opt-in-toggle.tsx
 * (CLAUDE.md's own circular-affordance exception). Default OFF — 0142's own
 * header explains why reviewing is a second, independent choice on top of
 * status='approved', not automatic for every vetted mentor.
 */
export function ReviewsVerificationsToggle({ optIn }: { optIn: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [optimisticOptIn, setOptimisticOptIn] = useOptimistic(optIn);

  return (
    <div className="flex items-center justify-between gap-4">
      <p className="max-w-[48ch] font-body text-[13.5px] text-ink-soft">
        Review candidates&apos; skills-verification submissions and decide whether they pass —
        paid per review. Off by default, separate from your mentor listing.
      </p>
      <button
        type="button"
        role="switch"
        aria-checked={optimisticOptIn}
        aria-label="Review Talent Directory verifications"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setOptimisticOptIn(!optIn);
            await setReviewsVerificationsOptInAction(!optIn);
          })
        }
        className={[
          "relative inline-flex h-[26px] w-[46px] flex-shrink-0 items-center rounded-full border-[1.5px] border-ink transition-colors",
          optimisticOptIn ? "bg-ink" : "bg-paper",
          isPending ? "opacity-50" : "",
        ].join(" ")}
      >
        <span
          className={[
            "inline-block h-[16px] w-[16px] rounded-full transition-transform",
            optimisticOptIn ? "translate-x-[25px] bg-paper" : "translate-x-[4px] bg-ink",
          ].join(" ")}
        />
      </button>
    </div>
  );
}
