import type { AdminMessageRow } from "@/lib/notifications/contract";
import { SELF_SEND_CONFIRM_WORD, audienceSentence, needsTypedSend } from "@/lib/admin/messages/self-send";

/** What the Send button of a message with no second approver carries: how many people it goes to, and over 50 an input for the word SEND. The Server Action checks the word; this only asks for it. */
export function SelfSendNotice({ message }: { message: Pick<AdminMessageRow, "requires_approval" | "audience_count"> }) {
  return (
    <div className="flex flex-col gap-3">
      <p data-testid="audience-line" className="text-[15px] font-semibold">
        {audienceSentence(message.audience_count)}
      </p>
      {needsTypedSend(message) && (
        <label className="flex flex-col gap-1 text-[14px]">
          <span>Type {SELF_SEND_CONFIRM_WORD} to confirm</span>
          <input type="text" name="confirmSend" autoComplete="off" className="min-h-[44px] w-48 border-[1.5px] border-ink bg-paper px-3 font-body text-[15px]" />
        </label>
      )}
    </div>
  );
}
