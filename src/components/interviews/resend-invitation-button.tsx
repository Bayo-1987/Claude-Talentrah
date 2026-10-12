"use client";

import { useRef, useState, useTransition } from "react";
import { resendInterviewInvitationAction } from "@/lib/interviews/actions";

export function ResendInvitationButton({ jobId, applicationId }: { jobId: string; applicationId: string }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);

  function resend() {
    if (busy.current) return;
    busy.current = true;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await resendInterviewInvitationAction({ jobId, applicationId });
        setMessage(result.ok ? { ok: true, text: "Invitation sent again." } : { ok: false, text: result.error });
      } catch {
        setMessage({ ok: false, text: "Couldn't reach Talentrah. Try again." });
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={resend} disabled={pending} className="min-h-11 self-start border-[1.5px] border-ink bg-card px-5 font-body text-[14px] font-semibold text-ink hover:border-rust hover:text-rust disabled:opacity-50">
        {pending ? "Sending…" : "Send the invitation again"}
      </button>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "font-body text-[13.5px] text-ink" : "font-body text-[13.5px] text-rust"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
