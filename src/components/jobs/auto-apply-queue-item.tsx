"use client";

import { useState, useTransition } from "react";
import { BorderedCard, Button, MatchTierBadge } from "@/components/ui";
import { confirmAutoApplyAction, dismissAutoApplyAction } from "@/lib/auto-apply/actions";

export interface QueueItem {
  id: string;
  jobTitle: string;
  companyName: string;
  location: string | null;
  matchScore: number;
  sourceType: "internal" | "external";
}

/**
 * One pending match, with the confirmation that makes it real.
 *
 * The two source types get visibly different buttons and different promises,
 * because they genuinely do different things — Talentrah can submit to its own
 * postings and cannot submit to Greenhouse or Lever on anyone's behalf.
 * Labelling both "Apply" would be the dishonest simplification.
 */
export function AutoApplyQueueItem({ item }: { item: QueueItem }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isInternal = item.sourceType === "internal";

  function run(fn: () => Promise<{ ok: boolean; error?: string; externalUrl?: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      // External confirmations hand the user to the source posting. Opened
      // after the server call so the tab only appears if the hand-off was
      // actually recorded.
      if (result.externalUrl) window.open(result.externalUrl, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <BorderedCard className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-display text-[18px] font-semibold text-ink">{item.jobTitle}</h3>
          <p className="mt-0.5 font-body text-[13.5px] text-ink-soft">
            {item.companyName}
            {item.location ? ` · ${item.location}` : ""}
            {!isInternal && " · sourced externally"}
          </p>
        </div>
        <MatchTierBadge score={item.matchScore} />
      </div>

      {error && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3 py-2 text-[13px] text-rust">
          {error}
        </p>
      )}

      <p className="font-body text-[13px] text-ink-soft">
        {isInternal
          ? "Confirming applies on Talentrah with your base resume."
          : "Talentrah can't submit to this employer's site for you. Confirming opens the posting so you can finish it, and saves it to your tracker."}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={isPending}
          onClick={() => run(() => confirmAutoApplyAction(item.id))}
        >
          {isPending ? "Working…" : isInternal ? "Confirm and apply" : "Open posting"}
        </Button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => dismissAutoApplyAction(item.id))}
          className="min-h-10 font-body text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
        >
          Not this one
        </button>
      </div>
    </BorderedCard>
  );
}
