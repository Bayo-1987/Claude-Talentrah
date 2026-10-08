"use client";

import { useActionState } from "react";
import { markMentorPaymentRefundedAction } from "@/lib/admin/ops/refund-actions";
import { initialRefundActionState } from "@/lib/admin/ops/refund-state";
import { BorderedCard, Button, NairaAmount } from "@/components/ui";
import { formatDate } from "@/lib/format/datetime";

export interface RefundRow {
  sessionId: string;
  amountNgn: number;
  markedAt: string;
  sessionStart: string;
  reference: string | null;
}

/** One action state for the whole list: the row leaves the list when it is resolved, so a per-row message would vanish with it. */
export function MentorRefundList({ rows }: { rows: RefundRow[] }) {
  const [state, action, pending] = useActionState(markMentorPaymentRefundedAction, initialRefundActionState);
  return (
    <>
      {state.status !== "idle" && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={"border-[1.5px] px-3.5 py-2.5 text-[13.5px] " + (state.status === "error" ? "border-rust bg-rust-soft text-rust" : "border-ink bg-card text-ink")}
        >
          {state.message}
        </p>
      )}
      <ul className="flex list-none flex-col gap-3 p-0">
        {rows.map((r) => (
          <li key={r.sessionId}>
            <BorderedCard className="flex flex-col gap-1.5 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="font-display text-[17px]">
                  <NairaAmount amount={r.amountNgn} />
                </span>
                <span className="text-[13px] text-ink-soft">marked {formatDate(r.markedAt)}</span>
              </div>
              <p className="text-[13.5px] text-ink-soft">
                Session <code className="text-[12.5px]">{r.sessionId}</code> · slot started {formatDate(r.sessionStart)}
              </p>
              <p className="text-[13.5px] text-ink-soft">
                Paystack reference {r.reference ? <code className="text-[12.5px]">{r.reference}</code> : "none on record (check the payment rows)"}
              </p>
              <form action={action}>
                <input type="hidden" name="sessionId" value={r.sessionId} />
                <Button type="submit" variant="secondary" size="sm" disabled={pending}>
                  {pending ? "Marking…" : "Mark refunded"}
                </Button>
              </form>
            </BorderedCard>
          </li>
        ))}
      </ul>
    </>
  );
}
