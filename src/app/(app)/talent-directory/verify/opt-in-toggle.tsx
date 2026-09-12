"use client";

import { useOptimistic, useTransition } from "react";
import { setDirectoryOptInAction } from "@/lib/talent-directory/actions";

/** Same round-switch affordance as auto-apply-toggle.tsx (CLAUDE.md's own circular-affordance exception). Default OFF — see 0135's own header on why opting in is independent of being verified. */
export function OptInToggle({ optIn }: { optIn: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [optimisticOptIn, setOptimisticOptIn] = useOptimistic(optIn);

  return (
    <div className="flex items-center justify-between gap-4">
      <p className="max-w-[48ch] font-body text-[13.5px] text-ink-soft">
        Local employers with a directory subscription can see your name, availability, and work
        samples. Off by default — this is separate from being verified.
      </p>
      <button
        type="button"
        role="switch"
        aria-checked={optimisticOptIn}
        aria-label="List me in the Talent Directory"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setOptimisticOptIn(!optIn);
            await setDirectoryOptInAction(!optIn);
          })
        }
        className={[
          "relative inline-flex h-[26px] w-[46px] flex-shrink-0 items-center rounded-full border-[1.5px] border-ink transition-colors",
          optimisticOptIn ? "bg-ink" : "bg-bg",
          isPending ? "opacity-50" : "",
        ].join(" ")}
      >
        <span
          className={[
            "inline-block h-[16px] w-[16px] rounded-full transition-transform",
            optimisticOptIn ? "translate-x-[25px] bg-bg" : "translate-x-[4px] bg-ink",
          ].join(" ")}
        />
      </button>
    </div>
  );
}
