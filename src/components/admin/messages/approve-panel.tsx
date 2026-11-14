"use client";

import type { AdminMessageKind } from "@/lib/notifications/contract";
import { ActionForm, type MessageAction } from "./action-form";
import { KIND_EXPLAINER, KIND_LABEL } from "./texts";

/**
 * The approval screen. The KIND of the message is its most prominent line, and approving needs the tick: the approver says what they are approving, and the database checks that
 * it is true. The creator cannot approve their own message; that rule is the database's, and its refusal is shown here as a sentence.
 */
export function ApprovePanel({ messageId, kind, action }: { messageId: string; kind: AdminMessageKind; action: MessageAction }) {
  return (
    <section aria-label="Approve this message" className="flex flex-col gap-4 border-[1.5px] border-ink bg-card p-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-rust">Approval</p>
      <h2 data-testid="approval-kind" className="font-display text-[34px] font-semibold leading-tight">
        {KIND_LABEL[kind]}
      </h2>
      <p className="text-[14px] text-ink-soft">{KIND_EXPLAINER[kind]}</p>
      <ActionForm action={action} targetId={messageId} hidden={{ id: messageId, kind }} label="Approve" pendingLabel="Approving…">
        <label className="flex items-start gap-3 text-[14px]">
          <input type="checkbox" name="confirmKind" value="yes" className="mt-1 h-5 w-5" />
          <span>I have read this message and I confirm it is a {KIND_LABEL[kind].toLowerCase()}.</span>
        </label>
      </ActionForm>
    </section>
  );
}
