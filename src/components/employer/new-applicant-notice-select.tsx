"use client";

import { useState, useTransition } from "react";
import { setNewApplicantNoticeAction } from "@/lib/employer/new-applicant-notice-actions";
import { NOTICE_LABELS, NOTICE_MODES, isNoticeMode, type NoticeMode } from "@/lib/employer/new-applicants/notice-mode";

/** How this person hears about new applicants. Saves on change; a failed save puts the previous choice back and says so. */
export function NewApplicantNoticeSelect({ initialMode }: { initialMode: NoticeMode }) {
  const [mode, setMode] = useState(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function change(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    if (!isNoticeMode(next)) return;
    const previous = mode;
    setMode(next);
    setError(null);
    startTransition(async () => {
      const result = await setNewApplicantNoticeAction(next);
      if (!result.ok) {
        setMode(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="new-applicant-notice" className="font-body text-[12.5px] font-semibold text-ink-soft">
        Emails about new applicants
      </label>
      <select
        id="new-applicant-notice"
        value={mode}
        onChange={change}
        disabled={pending}
        className="min-h-11 border-[1.5px] border-ink bg-card px-3 font-body text-[13.5px] text-ink outline-none focus:border-rust disabled:opacity-60"
      >
        {NOTICE_MODES.map((m) => (
          <option key={m} value={m}>
            {NOTICE_LABELS[m]}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="font-body text-[12.5px] text-rust">
          {error}
        </span>
      )}
    </div>
  );
}
