"use client";

import { useState } from "react";
import { BorderedCard } from "@/components/ui";
import { AutoApplyQueueItem, type QueueItem } from "@/components/jobs/auto-apply-queue-item";
import { MicroFeedbackPrompt } from "@/components/feedback/micro-feedback-prompt";

/**
 * Wraps the pending queue so "just confirmed" state can survive the list's
 * own re-render — AND survive the empty-vs-non-empty swap, which is the
 * part a first pass at this got wrong.
 *
 * WHY THIS CAN'T LIVE INSIDE `AutoApplyQueueItem`. `confirmAutoApplyAction`
 * calls `revalidatePath("/auto-apply")` on success, which re-fetches this
 * page's server data — the confirmed row moves from `pending` into
 * `history`, and the `AutoApplyQueueItem` instance for it unmounts as part
 * of that same re-render. Any "show the prompt" state held inside that
 * component vanishes along with it before anyone could see it.
 *
 * WHY THE EMPTY STATE HAS TO LIVE IN HERE TOO, NOT IN THE PARENT PAGE.
 * Confirmed live, not just reasoned about: the parent Server Component used
 * to choose between this list and a separate "Nothing waiting" card with a
 * `pending.length === 0 ? <Card/> : <AutoApplyQueueList/>` ternary. The
 * moment the LAST pending item gets confirmed, `pending` becomes `[]` on
 * the very re-render that should show the prompt — and that ternary swaps
 * to the OTHER branch, unmounting this component (and the state it holds)
 * at exactly the moment it mattered. Confirming a lone pending item in a
 * real browser showed "Nothing waiting" with no prompt anywhere, silently —
 * the same failure mode this component exists to prevent, just one level
 * up. The fix is this component staying mounted regardless of `items`
 * length (the parent always renders it), and deciding what to show
 * internally.
 */
export function AutoApplyQueueList({ items }: { items: QueueItem[] }) {
  const [justConfirmedJobTitle, setJustConfirmedJobTitle] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-3.5">
      {items.length === 0 && !justConfirmedJobTitle ? (
        <BorderedCard className="p-8 text-center">
          <p className="font-display text-[19px] font-medium text-ink">Nothing waiting</p>
          <p className="mx-auto mt-2 max-w-[46ch] font-body text-[14px] text-ink-soft">
            Auto-Apply only queues Excellent matches, so an empty queue usually means there
            aren&apos;t any right now — not that it isn&apos;t working.
          </p>
        </BorderedCard>
      ) : (
        items.map((item) => (
          <AutoApplyQueueItem key={item.id} item={item} onConfirmed={setJustConfirmedJobTitle} />
        ))
      )}
      {justConfirmedJobTitle && (
        <MicroFeedbackPrompt
          context="auto_apply_confirm"
          prompt="Glad we found that one — how'd the confirm go?"
          pagePath="/auto-apply"
        />
      )}
    </section>
  );
}
