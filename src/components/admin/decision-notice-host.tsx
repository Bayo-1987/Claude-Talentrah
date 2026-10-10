"use client";

import { useEffect, useSyncExternalStore } from "react";
import { dismissDecisionNotice, getDecisionNotice, subscribeDecisionNotice } from "@/lib/admin/moderation/decision-notice";

const NOTICE_SECONDS = 12;
const noNotice = () => null;

/**
 * The confirmation for a decision that removed its own row (QA DECISION-SILENT-1), shown in the admin layout so it survives the row. A polite status region; it goes away by itself after a few
 * seconds and can be dismissed. Renders nothing until a decision has been announced.
 */
export function DecisionNoticeHost() {
  const notice = useSyncExternalStore(subscribeDecisionNotice, getDecisionNotice, noNotice);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(dismissDecisionNotice, NOTICE_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <p role="status" className="pointer-events-auto flex max-w-[640px] items-center gap-4 border-[1.5px] border-ink bg-card px-4 py-3 text-[13.5px] text-ink">
        <span>{notice.message}</span>
        <button type="button" onClick={dismissDecisionNotice} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center font-body text-[13px] font-semibold text-ink-soft hover:text-rust">
          Dismiss
        </button>
      </p>
    </div>
  );
}
